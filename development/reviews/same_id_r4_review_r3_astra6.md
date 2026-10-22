# Same-ID R4 round 3 review

NOT-LAND-SAFE for `75f1c98b..c02c0c02`: **0 B, 1 M, 2 m**. The four round-2 majors' original reproducers close. New M-1 still permits a malformed runtime-Herdr answer to become a persisted death. New m-1 is a narrow strict-record parser hole; m-2 is a conservative documentation mismatch. Finding IDs restart here; the M-2–M-5 identifiers in the closure table refer to review r2.

Reviewed independently on branch `review/same-id-r4-r3`, tip `c02c0c02c1da202aa1da679fce0381346252061f`; focused delta `8e9efe95..c02c0c02`. The author report was read only after independent source review, both-version reproductions and the absence-table audit. No production edit, commit, pull, rebase, push or PR. This review and the report are uncommitted.

| Review-r2 finding | Closure at c02c0c02 | Source and caller evidence |
| --- | --- | --- |
| M-2, impossible PIDs | Original cases closed | Codex `index.ts:627`, Gemini `:258`, OpenCode `:1404` and `:719`: every row has a positive, safe integer PID. Zero/unsafe cases reject; lifecycle keeps working and send has no AgentNotAttachedError/restore. |
| M-3, pane identity and contradictory envelope | Original cases closed; new distinct M-1 remains | Core `herdr.ts:96,122` rejects the wrong process-info pane and contradictory result/error. Runtime `index.ts:115,243` rejects the contradictory envelope and nontext terminal. Wrong-pane lifecycle probe now keeps working; explicit missing/empty/replaced-terminal controls remain negative. |
| M-4, wrong tmux target/failure type | Closed | Codex `:590`, Gemini `:221`, OpenCode `:1367,687`: code 1, no signal, not killed, complete requested-session or no-current-target diagnostic. Wrong-name, mixed stderr and killed call reject; lifecycle/send preserve unknown. |
| M-5, malformed active/latest-archive holder content | Original cases closed; narrow new m-1 remains | New strict readers `metadata.ts:452,763`, used at `session-manager.ts:1031,1035`. Both old malformed-holder fixtures retain app-1 and call remove zero times. New malformed ordinary duplicate/empty-key tests also pass. |

Old M-1 (Git discovery diagnostic) remains closed. The lower-level Git controls, including real Git outside a repository and dubious ownership, pass in this review.

## Initial notes and evidence

Initial review scope: `75f1c98b..c02c0c02`, focused delta `8e9efe95..c02c0c02`. No production edits or commit. All executable checks use `/tmp/aor4r3/run` (`env -i`, scratch HOME/TMPDIR/AO paths, gh stub). The tmux shim clears AO variables and uses `-f /dev/null -L aor4r3-review`. No real agent/Herdr/OpenCode process, model turn, network gh or real AO operation. At this initial stage the author report was unread pending independent items 1–2.

Before `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

## Independent source review

Round 3 adds positive/safe PID checks to all four changed process readers and exact tmux failure matching (code 1, no signal, not killed, whole requested-name/no-current-target line). Core Herdr now rejects contradictory envelopes and a supplied process-info pane ID that differs from the request. Runtime Herdr rejects contradictory envelopes and nontext terminal IDs. The strict key-value parser is appended; the old function is unchanged. Only hasOtherOpenCodeRecord uses the new strict metadata readers. Recovery now preserves nonboolean workspace responses as probeError/skip.

Potential table differences under test: runtime-herdr's common parser still falls back to a top-level pane without result; the strict record parser stores into a normal object, so __proto__ may evade its duplicate-key check. The cleanup note is being checked separately from the changed holder gate; no author report used yet.

## Independent execution findings (before reading the author report)

The extracted r2 boundary/lifecycle suite is 28 passed / 23 failed on `8e9efe95`, and 51 passed / 0 failed on `c02c0c02`. The two malformed-holder cleanup and two OpenCode send reproducers are 0 passed / 4 failed on the base, 4 passed / 0 failed on the tip. The built Herdr stand-in retains the missing-pane, valid-empty-list and replaced-terminal negatives and now rejects the wrong process-info pane. The ordinary r2 cases of M-2 through M-5 close.

The independent 83-case round-3 boundary suite has 78 passes and five failures: three runtime-Herdr envelopes outside row 9 resolve false, and two duplicate `__proto__` records do not reject. These are new coverage gaps, not failures of the author's existing tests.

- M-1 (retained in changed R4 code): `runtime-herdr/src/index.ts:135` falls back to the top-level object when `result` is absent/null/scalar. `getPaneStrict` at :238 accepts its `pane`, and `isAlive` at :489 calls a different terminal dead. For handle `{id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}}`, exit-0 body `{"pane":{"pane_id":"w7:p1","terminal_id":"term_b"}}` resolves false. So do that body plus `result:null` or `result:12`. Row 9 requires `result.pane`. Through the real session manager, `list` reports killed/exited; with a second live session, two lifecycle polls persist killed/runtime. A valid wrapped replacement is a negative control; a command rejection preserves working. The first caller experiment had no live control and correctly encountered the older global outage bound; the corrected two-session experiment distinguishes it. No claim of a physical runtime stop is made. Require a valid object `result` for the pane-get read before the generic parser fallback; add bare/null/scalar-envelope rejection tests and the caller control. Other Herdr command parsers can retain their separate compatibility behavior.
- m-1 (introduced in R4 round 3): `core/src/key-value.ts:29,39–42` uses `{}` plus `Object.hasOwn`. A string assignment to `__proto__` does not install an own key, so `__proto__=a\n__proto__=a\n` and the different-value variant both return `{}`. Rows 3/4 promise to hold any duplicate key. With this as app-2's record in the existing cleanup fixture, `removeOpenCodeSession('ses_shared',10000,undefined)` is called once instead of zero. This is a narrow schema/guard hole; it does not inject an OpenCode ID or demonstrate prototype pollution. Ordinary duplicate `opencodeSessionId` is correctly rejected. A separate seen-key set or a null-prototype result would close it.
- m-2 (new documentation): row 11, `docs/DEVELOPMENT.md:478`, omits the "without a leading zero" restriction that row 10 states. Its positive-safe-integer wording includes decimal `01`, while `agent-opencode/src/index.ts:719` rejects `01 ?\n`. The send returns `cannot check the OpenCode TUI ... not a process list`, not the documented no-OpenCode/AgentNotAttachedError result. This is conservative and not a host-ps regression; make the table's lexical form exact.

The note under the table is accurate: setting the cleaned session's runtime AND agent negative lets cleanup remove `ses_shared` despite a damaged other record on both base and tip. That is the older kill-route/F-5 limitation, separate from the changed holder gate.

All table-cited tests were found (including parameterized titles); the selected set passed 775 tests, with one reviewer-added row-11 repro explicitly excluded (the known m-2 failure). Two citations in `same-id-defects.test.ts` were outside that selected run and are covered by the worktree core suite. Every row has a gone control and a rejecting/holding near miss; the three forms above are not pinned by the cited tests. Independent items 1 and 2 were completed before reading the current author report.

## Absence table: each row against code

“Wider” means the implementation accepts more absence than the table permits; “narrower” means it rejects a form the wording permits. Each row's cited tests exists; expanded parameterized names were checked against the JSON test results. The two citations from `core/src/__tests__/same-id-defects.test.ts` were verified in that file and passed in the complete core suite and red run. No row is missing its named gone/near-miss test. Those tests do not establish completeness: the new boundaries expose the gaps below.

| Row | Result | Evidence and limit |
| --- | --- | --- |
| 1 archive allocation | Agrees | Only directory ENOENT is the read-error negative; valid archived ID names reserve their number. Missing-directory control allocates app-1. ELOOP/EACCES reject before reservation/workspace/runtime. Empty or irrelevant-name lists naturally contain no archived IDs. |
| 2 active holder listing | Agrees | ENOENT listing/stat or nonfile entry contributes no holder; all other errors hold. ELOOP near miss and no-other-record removal control pass. |
| 3 active holder content | **Wider: m-1** | Ordinary delimiter/key/duplicate damage holds, but duplicate `__proto__` is silently omitted. Missing/empty/comment-only content, equals inside a value, CRLF, BOM and a 200,000-character value behave as the table describes. |
| 4 latest archive content | **Wider: same m-1** | Uses the same parser. Otherwise correct digit-prefixed, lexicographically latest selection; unreadable/malformed/missing-after-listing content holds. ENOENT of the outer archive enumeration is “no archives”; ENOENT of the later reread returns null and holds. The final column covers this disappearance distinction. Empty latest archive is an explicit passing negative control. |
| 5 recovery path | Agrees | lstat ENOENT advances to the plugin check; other path failures set probeError/skip. Missing-path, ELOOP and EACCES tests pass. |
| 6 recovery workspace probe | Agrees | Exactly boolean false/true are negative/positive. Rejection and nonboolean result retain unknown and skip. The new guard is correct and stays in the allowed validator. |
| 7 worktree exists | Agrees | lstat ENOENT or Git code 128 with a complete allowed diagnostic is negative; LC_ALL=C is explicit. Successful trimmed true is positive. Extra-line, translated/dubious-ownership and wrong-code failures reject. Both real-Git controls pass. |
| 8 core Herdr | Agrees | Lone exit-0 pane_not_found with absent/null result, or a valid process list for the requested pane (pane_id optional), are the negatives. Wrong typed/other pane ID, result:{}, error:{}, error without code, and contradiction reject. Empty handle shortcut is documented and guarded by callers. |
| 9 runtime Herdr | **Wider: M-1** | Documented wrapped pane controls and lone error work, but bare top-level pane is accepted with result absent/null/scalar. Different terminal then falsely yields dead. Numeric terminal, wrong pane, malformed/error-only near misses reject as required. Null/empty/absent terminal are the explicit positive exceptions. |
| 10 three agent liveness reads | Agrees | Exact tmux stderr/failure shape and full ps validation match. CRLF, two final newlines, prefix/suffix target names, translated text, impossible PIDs and extra header column reject. The three documented header aliases pass; valid shell-only list remains negative. |
| 11 OpenCode send/launch | **Narrower wording: m-2** | Same strict tmux handling works; unsafe PIDs reject without restore/send, and launch fails promptly. The text omits the no-leading-zero restriction of its PID regex. The unchanged /proc error-to-null limitation is explicitly disclosed and is F-7 below. |

Host check, using only the private `aor4r3-forms` socket: tmux is 3.4; with `review-1` present, target `=review-12:` exits 1 with `can't find session: review-12\n`. A live server configured to stay with no sessions exits 1 with `no current target\n`. Neither stated negative is fictional on this host. Actual ps header was `PID TT COMMAND`. Another tmux/ps version, localization or wrapper that changes these strings can keep the corresponding agent probe unknown until repaired; no version other than host tmux 3.4 was tested. Synthetic translated/CRLF forms reject. Runtime-tmux has its separate probe and the older no-server bound (F-1); an agent rejection alone never proves gone.

The cleanup note at `docs/DEVELOPMENT.md:480` is accurate. The two both-self-probes-dead experiments call `removeOpenCodeSession('ses_shared',10000,undefined)` on base and tip even with malformed other metadata. They confirm the older kill route's limit, not the protection of rows 2–4 under every possible cleanup reason.

## Caller availability

| Caller | Owner-visible result and next action |
| --- | --- |
| Lifecycle poll | Probe rejection retains persisted status and breaks a consecutive-negative run. Later polls retry. The old no-server/outage bounds remain; new M-1 can still supply a false negative. The corrected Herdr caller repro includes a genuinely positive second session so the global outage rule does not mask it. |
| ao status | Built CLI with malformed/unsafe ps or wrong-target tmux shows working and null activity on tip, leaves the metadata byte-equivalent as parsed, and does not repair it. It does not display the probe cause; that existing diagnostic weakness remains. Inspect the failed tool and retry. |
| Kill | A runtime stop must be confirmed before record/workspace/agent removal. Unknown stop reports kept plus manual check/retry. Herdr's explicit manual-close refusal remains; retry alone cannot perform that close. Malformed stored handles/plugin absence are older F-4. |
| Cleanup | Runtime rejection yields the kept/error message with runtime identity/cause and manual check/retry. Strict holder failures hold through the dead-runtime gate while self liveness is uncertain; the existing message can name the cleaned live session rather than the damaged record, so diagnosis requires inspecting metadata. PR/issue completion and the both-dead kill route are not claimed covered by rows 2–4 (F-5). |
| Restore | Workspace probe errors propagate before stop or recreation; Git diagnostic/path permits ownership/config repair and retry. Active-restore refusal keeps the record/workspace. Existing tests and both-version controls remain green. |
| Recovery | Path/plugin/agent/runtime unknown produces partial, action skip and `Liveness unknown (...); no action`; no cleanup/escalation/recovery mutation is inferred. Correct the reported read and retry. Nonboolean workspace output is now handled safely. |
| OpenCode send and launch | Strict-read rejection stops send with `cannot check the OpenCode TUI ...`, no prompt call and no AgentNotAttachedError, so the one-restore path is not requested. Launch aborts its confirmation promptly with the cause. Explicit pane-gone and valid-list/no-TUI controls keep their old restore/wait behavior. |
| OpenCode removal | Malformed/unreadable possible holders hold the changed cleanup gate. Empty latest archive and a valid nonmatching mapping remain removable; the older lenient kill/remap/other holder readers remain F-5. API removal failures retain the existing retry behavior; R4 does not change it. |

A zero-byte archive is explicitly valid, so it does not hold all cleanup forever. The existing author control and the review's empty/comment-only parser controls pass. A persistent noncanonical duplicate or damaged file can hold an uncertain session until someone repairs it; this is the intentional conservative consequence, not an automatically expiring lease. Ordinary retained tmux panes and their ps output continue to classify. No real Herdr/OpenCode/model call was made: live protocol compatibility beyond the repository fixtures/stand-ins is not claimed.

## Scope, oracle changes and commits

`key-value.ts` on 8e9efe95 is a byte-for-byte prefix of the tip; exactly the new exported function is appended. The lenient parser and all previous lines stay unchanged. `agent-claude-code/src/index.ts` has zero diff for the entire `75f1c98b..c02c0c02` range. Rows 6 and 9 are allowed-file corrections and handle boolean/terminal typing correctly. CLAUDE.md adds only the sentence pointing at the table; it does not close the table mismatches found here.

The five existing oracle changes are permitted by Amendment 1: the three agent index tests now reject code-1 `can't find window: test-session\n` for a session-only target; the OpenCode confirmLaunch test with no code now expects `could not answer`, still within its <2s bound; the OpenCode deliverMessage test with no code now expects no AgentNotAttachedError and `cannot check`, with its no-prompt assertion retained. Inputs and unrelated assertions were preserved. Separate new controls supply code 1 and the exact matching session diagnostic. The lifecycle harness adds knobs for new cases but preserves old defaults. No test was weakened or marked to hide a new failure.

The six single-parent commits form a straight line from 8e9efe95:

- `18133d66` fix(herdr): take a Herdr answer only for the requested pane and without contradiction
- `dd3812d1` fix(agents): accept only tmux's whole missing-pane answer and real PIDs
- `2a0d4037` fix(core): hold an OpenCode session that a damaged record may name
- `00585ad0` fix(recovery): read a workspace check that is not a boolean as unknown
- `ff98072d` docs: add the table of absence forms of the R4 reads
- `c02c0c02` docs: state where the R4 holder reads stop in the cleanup

All have substantive WHY bodies, no Co-Authored-By/trailer, emoji or issue number. Delta is 19 files, +991/-52, all in the allowed file set. `git branch -r --contains c02c0c02` prints nothing. The review performed no branch/index mutation.

## Mutant checks

All mutations were confined to `/tmp/aor4r3/tip`, restored sequentially, and each changed production file compared byte-equal to the worktree afterwards. Tests alias core to that copy's source, so they exercise the mutation rather than stale dist. Existing unmutated tests passed in the selected/whole suites; the independent ordinary-duplicate tests were also rerun unmutated (2 passed).

| Mutant | Targeted result | Failing evidence |
| --- | --- | --- |
| M-2: restore digits-only Codex ps rows | 186 passed, 4 failed | PID 0, unsafe PID, extra invalid row, and two-poll unsafe-PID lifecycle case. |
| M-3: restore base core/runtime Herdr source | 80 passed, 10 failed | Six core identity/contradiction cases; four runtime contradiction/error-type/terminal-type cases. |
| M-4: restore Codex prefix-only tmux stderr match | 182 passed, 8 failed | Wrong target, other line, no-current-target after text, wrong/missing code, killed call, window diagnosis, plus caller lifecycle case. |
| M-5: holder gate uses old lenient readers | 7 passed, 6 failed | Active and archive, each missing delimiter, empty key and repeated key. |
| Own: remove the strict parser's duplicate check | 0 passed, 2 failed | `opencodeSessionId` repeated with the same value and with a different value. Unmutated both reject/pass. |

The first M-5 test-name filter accidentally excluded the two author tests containing `(review r2)`; a corrected targeted run above includes all six. This was a test-selection correction, not an additional source change.

Exact failing test names and restoration checks:

```text
M2 exit 1 pass 186 fail 4
  isProcessRunning rejects a ps row with PID 0
  isProcessRunning rejects a ps row with a PID too large to be exact
  isProcessRunning rejects a valid list with one more row whose PID is 0
  same-id R4 round 3 (review r2, M-2, M-3, M-4): the lifecycle with the real Codex plugin keeps app-1 working over two polls when a ps row has a PID that is too large to be exact
M3 exit 1 pass 80 fail 10
  getHerdrPaneProcesses: only an answer for the requested pane is evidence rejects the process-info of another pane with an empty list
  getHerdrPaneProcesses: only an answer for the requested pane is evidence rejects the process-info of another pane with a list with a shell
  getHerdrPaneProcesses: only an answer for the requested pane is evidence isHerdrProcessRunning rejects the process-info of another pane instead of answering 'no agent'
  getHerdrPaneProcesses: only an answer for the requested pane is evidence rejects a process-info pane_id that is not text
  getHerdrPaneProcesses: only an answer for the requested pane is evidence rejects an answer with the pane_not_found error and a result for the requested pane with the agent
  getHerdrPaneProcesses: only an answer for the requested pane is evidence rejects an answer with the pane_not_found error and a result for the requested pane with an empty list
  isAlive(): a contradictory or malformed pane answer is unknown rejects the pane_not_found error with a result for the requested pane with its terminal
  isAlive(): a contradictory or malformed pane answer is unknown rejects the pane_not_found error with a result for the requested pane with a replaced terminal
  isAlive(): a contradictory or malformed pane answer is unknown rejects an error that is not an object, with a result for a replaced terminal
  isAlive(): a contradictory or malformed pane answer is unknown rejects the requested pane with a terminal_id that is not text
M4 exit 1 pass 182 fail 8
  isProcessRunning rejects 'can't find window', which tmux does not answer for a session-only target (round 3, M-4)
  isProcessRunning rejects a tmux failure where the missing-target line names another session
  isProcessRunning rejects a tmux failure where 'no current target' comes after another line
  isProcessRunning rejects a tmux failure where the line for this session comes with another line
  isProcessRunning rejects a tmux failure where the call was killed (a timeout) with the line for this session
  isProcessRunning rejects a tmux failure where the call has another exit code
  isProcessRunning rejects a tmux failure where the call has no exit code
  same-id R4 round 3 (review r2, M-2, M-3, M-4): the lifecycle with the real Codex plugin keeps app-1 working over two polls when tmux answers the missing-target line for another session
M5 final 1 7 6
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed active record with a line without a delimiter (review r2) keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed active record with a line with an empty key keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed active record with a key that comes twice keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed archive record with a line without a delimiter (review r2) keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed archive record with a line with an empty key keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 3 (M-5): a malformed archive record with a key that comes twice keeps the session, with the holder reason
own baseline 0 2 0
restored packages/plugins/agent-codex/src/index.ts True
restored packages/core/src/herdr.ts True
restored packages/plugins/runtime-herdr/src/index.ts True
restored packages/core/src/key-value.ts True
restored packages/core/src/session-manager.ts True
own-duplicate exit 1 pass 0 fail 2
  strict record rejects duplicate opencodeSessionId=ses_a
  strict record rejects duplicate opencodeSessionId=ses_a
```

## Worktree gates and clean combination with main

All executable commands used `/tmp/aor4r3/run` (the isolated env quoted below). Worktree gates:

```sh
HUSKY=0 pnpm install --frozen-lockfile
pnpm build
pnpm --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode --filter @aoagents/ao-integration-tests test
pnpm lint
pnpm typecheck
pnpm -r --no-bail test
```

Each exits 0. Frozen install reports the lockfile up to date. Build precedes dependent suites. Lint reports 0 errors and five pre-existing warnings (three non-null assertions, two session-manager console calls); typecheck passes. Normal core suite has one expected failure; integration has 24 skipped real-binary tests; SCM has five skips. No skipped real-agent test is represented as passing.

Exact filtered suite summary lines:

```text
Scope: 10 of 15 workspace projects
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1611 passed | 1 expected fail (1612)
packages/core test: Done
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  62 passed (62)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/runtime-herdr test: Done
packages/plugins/workspace-worktree test: Done
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/runtime-tmux test: Done
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-gemini test: Done
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/agent-claude-code test: Done
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  247 passed (247)
packages/plugins/agent-codex test: Done
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/plugins/agent-opencode test: Done
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/integration-tests test: Done
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
packages/cli test: Done
```

Full recursive run (exit 0):

```text
Scope: 14 of 15 workspace projects
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1611 passed | 1 expected fail (1612)
packages/core test: Done
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-gemini test: Done
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  247 passed (247)
packages/plugins/agent-codex test: Done
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/notifier-desktop test: Done
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/agent-claude-code test: Done
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  62 passed (62)
packages/plugins/runtime-herdr test: Done
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/scm-github test: Done
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/tracker-github test: Done
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/runtime-tmux test: Done
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/workspace-worktree test: Done
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/plugins/agent-opencode test: Done
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/integration-tests test: Done
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
packages/cli test: Done
```

`SAME_ID_DEFECTS=red` ran all 14 same-id-defects/reuse-window files across core, CLI and the plugins, with core aliased to current worktree source: exit 1 as expected, 70 passed / 22 failed / 0 skipped. R1 17 passed / **0 failed**; R2 20 passed / **16 failed**; R3 0 passed / **6 failed**; R4 33 passed / **0 failed**. An initial wrong package filter matched no project and is not counted; the complete run above supplies the evidence. The new independent reproducers are not part of this existing red suite.

Captured `main` for the combination was `4e8008a0bf1da975f3e55fdee98e1fe60ed86bab`. `git merge-tree --write-tree main c02c0c02` was clean, merge base `75f1c98be3b45b37c51cc8eb665f0d01149a55e7`, output tree `b62a202d8e5129d4fabc0c254c8b42fabf17f968`. An archive of that tree, `/tmp/aor4r3/merged`, was built before its tests; no checkout merge was performed. `pnpm build` exits 0, followed by all eight requested package suites (exit 0). This includes main's Codex send and Claude detectActivity/CLI verification changes:

```text
Scope: 8 of 15 workspace projects
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1611 passed | 1 expected fail (1612)
packages/core test: Done
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-gemini test: Done
packages/plugins/agent-codex test:  Test Files  6 passed (6)
packages/plugins/agent-codex test:       Tests  307 passed (307)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  62 passed (62)
packages/plugins/agent-codex test: Done
packages/plugins/runtime-herdr test: Done
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/plugins/agent-claude-code test: Done
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/workspace-worktree test: Done
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/plugins/agent-opencode test: Done
packages/cli test:  Test Files  23 passed (23)
packages/cli test:       Tests  323 passed (323)
packages/cli test: Done
```

## Follow-ups, not landing conditions

- F-1: R2b runtime launch/server identity, default-socket ambiguity and old no-server/outage bounds. Unchanged.
- F-2: R3 operation/workspace/OpenCode ownership serialization; six R3 red failures remain.
- F-3: Cleanup still probes the project runtime rather than always selecting the stored handle runtime (`session-manager.ts:3410`); mismatched configuration can retain a session indefinitely. Unchanged.
- F-4: Older missing/malformed runtime-handle and unloaded-plugin guards in kill/recovery, outside these reads.
- F-5: `findLiveOpenCodeSessionHolder` and other old holder/removal routes still use lenient enumeration/parsing. Extend the earlier remap follow-up to the independently confirmed both-self-dead cleanup/kill route: a damaged sibling does not prevent removal there. Also covers unchanged orchestrator-delete, archived-purge and failed-launch/ledger namer reads as applicable. This review claims no new remap concurrency experiment.
- F-6: Claude `findClaudeProcess` malformed-success-to-absence handling. Its source is unchanged by R4; main's separate detectActivity landing does not change that review boundary. No real Claude call made.
- F-7 (newly tracked older limitation): OpenCode `readProcessArgv` at `index.ts:611` maps every /proc read failure to null, so non-ENOENT failures count as not OpenCode. Table row 11 discloses it. That helper is unchanged by R4; no real OpenCode/proc-permission experiment is claimed.

What is correct: original r2 reproducers now close; complete-list PID validation and exact tmux identity/failure checks are effective; core Herdr rejects the wrong requested identity and contradictions; the metadata readers preserve I/O uncertainty and ordinary malformed records; recovery keeps nonboolean output unknown; empty files and real explicit-gone controls remain useful; the five oracle changes preserve their inputs; clean merge and all required normal gates pass. These successes do not discharge the new malformed-envelope M-1.

## Reproduction appendix

All own code below was executed only in scratch copies; it was not added to production tests. The r2 sources remain fully available in `development/reviews/same_id_r4_review_r2_astra6.md`, sections “Reproducers retained after scratch cleanup”; this run changes their scratch prefix to `/tmp/aor4r3`. The r2 boundary/lifecycle suite gives base 28/23 and tip 51/0; cleanup/send gives base 0/4 and tip 4/0. Built Herdr stand-in on base and tip gives the same controls and closes the wrong process-info pane as shown earlier. Built CLI probe additionally exercises impossible PID and wrong-target stderr; it asserts status reads never mutate the record.

Example per-copy command (use `base` for the old source):

```sh
/tmp/aor4r3/run node packages/core/node_modules/vitest/vitest.mjs run --root /tmp/aor4r3/tip --config /tmp/aor4r3/tip/review.config.mjs review-r3-boundaries --reporter=json --outputFile=/tmp/aor4r3/logs/new-tip.json
```

Isolation wrapper:

```sh
#!/bin/sh
exec env -i HOME=/tmp/aor4r3/home TMPDIR=/tmp/aor4r3/tmp PATH=/tmp/aor4r3/bin:/usr/bin:/bin CI=1 AO_STATE_ROOT=/tmp/aor4r3/home/.agent-orchestrator AO_CONFIG_PATH=/tmp/aor4r3/config.yaml "$@"
```

Per-copy Vitest source aliases:

```js
const ROOT='/tmp/aor4r3/tip';
export default {resolve:{alias:[{find:/^@aoagents\/ao-core\/(.*)$/,replacement:ROOT+'/packages/core/src/$1.ts'},{find:'@aoagents/ao-core',replacement:ROOT+'/packages/core/src/index.ts'}]},test:{maxWorkers:2,testTimeout:15000,exclude:['**/node_modules/**','**/dist/**']}};```

Executed 83-case boundary suite, `core/src/__tests__/review-r3-boundaries.test.ts` (78 pass / 5 fail):

```ts
import {it,expect,vi,afterEach} from 'vitest';
const exec=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();return {...actual,execFile:Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec})};});
import {getHerdrPaneProcesses} from '../herdr.js';
import {parseKeyValueContentStrict} from '../key-value.js';
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {create as gemini} from '../../../plugins/agent-gemini/src/index.js';
import {create as opencode} from '../../../plugins/agent-opencode/src/index.js';
import {create as herdr} from '../../../plugins/runtime-herdr/src/index.js';
afterEach(()=>vi.resetAllMocks());
const h={id:'review-12',runtimeName:'tmux',data:{}};
for(const [name,create] of [['codex',codex],['gemini',gemini],['opencode',opencode]] as const){
 for(const [label,stderr] of [['CRLF',"can't find session: review-12\r\n"],['two newlines',"can't find session: review-12\n\n"],['prefix name',"can't find session: review-1\n"],['suffix name',"can't find session: review-123\n"],['locale',"Sitzung nicht gefunden: review-12\n"]] as const)it(`${name} tmux rejects ${label}`,async()=>{exec.mockRejectedValue(Object.assign(Error('failed'),{code:1,killed:false,signal:null,stderr}));await expect(create().isProcessRunning(h)).rejects.toThrow();});
 for(const stderr of ["can't find session: review-12","can't find session: review-12\n",'no current target\n'])it(`${name} matching tmux control ${JSON.stringify(stderr)}`,async()=>{exec.mockRejectedValue(Object.assign(Error('failed'),{code:1,killed:false,signal:null,stderr}));expect(await create().isProcessRunning(h)).toBe(false);});
 for(const pid of ['01','+1','-1','1.0','1e2','9007199254740992'])it(`${name} rejects PID ${pid}`,async()=>{exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?'/dev/pts/73\n':` PID TT COMMAND\n${pid} pts/73 /bin/bash\n`,stderr:''}));await expect(create().isProcessRunning(h)).rejects.toThrow();});
 for(const header of ['PID TT COMMAND','PID TTY ARGS','PID TT CMD'])it(`${name} accepted ps header ${header}`,async()=>{exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?'/dev/pts/73\n':` ${header}\n1 pts/73 /bin/bash\n`,stderr:''}));expect(await create().isProcessRunning(h)).toBe(false);});
 it(`${name} rejects extra header column`,async()=>{exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?'/dev/pts/73\n':' PID TT COMMAND EXTRA\n1 pts/73 /bin/bash\n',stderr:''}));await expect(create().isProcessRunning(h)).rejects.toThrow();});
}
const hh={id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}};
for(const pane_id of [12,null,{},['w7:p1']])it(`core rejects pane id ${JSON.stringify(pane_id)}`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{process_info:{pane_id,foreground_processes:[]}}}),stderr:''});await expect(getHerdrPaneProcesses('w7:p1')).rejects.toThrow();});
for(const target of ['core','runtime'] as const){
 const query=()=>target==='core'?getHerdrPaneProcesses('w7:p1'):herdr().isAlive(hh);
 for(const value of [{result:{}},{error:{}},{error:{message:'pane_not_found'}},{error:[]},{error:{code:'pane_not_found'},result:{}}])it(`${target} rejects ${JSON.stringify(value)}`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify(value),stderr:''});await expect(query()).rejects.toThrow();});
 it(`${target} lone missing error null result control`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({error:{code:'pane_not_found'},result:null}),stderr:''});expect(await query()).toEqual(target==='core'?[]:false);});
}
for(const [label,body] of [
 ['bare pane',{pane:{pane_id:'w7:p1',terminal_id:'term_b'}}],
 ['null result plus bare pane',{result:null,pane:{pane_id:'w7:p1',terminal_id:'term_b'}}],
 ['scalar result plus bare pane',{result:12,pane:{pane_id:'w7:p1',terminal_id:'term_b'}}],
] as const)it(`runtime rejects ${label} outside row 9`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify(body),stderr:''});await expect(herdr().isAlive(hh)).rejects.toThrow();});
it('runtime same pane empty terminal is present per row 9',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{pane:{pane_id:'w7:p1',terminal_id:''}}}),stderr:''});expect(await herdr().isAlive(hh)).toBe(true);});
for(const [label,content,value] of [
 ['equals in value','opencodeSessionId=ses_a=b\n','ses_a=b'],
 ['CRLF','opencodeSessionId=ses_a\r\n','ses_a'],
 ['BOM','\ufeffopencodeSessionId=ses_a\n','ses_a'],
 ['long line','opencodeSessionId='+'a'.repeat(200000)+'\n','a'.repeat(200000)],
] as const)it(`strict record accepts ${label}`,()=>{expect(parseKeyValueContentStrict(content).opencodeSessionId).toBe(value);});
for(const content of ['opencodeSessionId=ses_a\nopencodeSessionId=ses_a\n','opencodeSessionId=ses_a\nopencodeSessionId=ses_b\n','__proto__=a\n__proto__=a\n','__proto__=a\n__proto__=b\n'])it(`strict record rejects duplicate ${content.split('\n')[0]}`,()=>{expect(()=>parseKeyValueContentStrict(content)).toThrow();});
it('empty and comment-only record controls',()=>{expect(parseKeyValueContentStrict('')).toEqual({});expect(parseKeyValueContentStrict('# comment\r\n \n')).toEqual({});});
```

Executed runtime caller, `core/src/__tests__/review-r3-runtime-caller.test.ts` (bare-pane fails; wrapped replacement and command-error controls pass):

```ts
import {it,expect,vi} from 'vitest';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
const exec=vi.hoisted(()=>vi.fn());vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();return {...actual,execFile:Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec})};});
import {create as herdr} from '../../../plugins/runtime-herdr/src/index.js';
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {createSessionManager} from '../session-manager.js';import {createLifecycleManager} from '../lifecycle-manager.js';import {readObservabilitySummary} from '../observability.js';import {readMetadataRaw,writeMetadata} from '../metadata.js';
import {createMockPlugins,createMockRegistry,createTestEnvironment} from './test-utils.js';
for(const mode of ['bare-pane','well-formed-replacement','error'] as const)it(`lifecycle ${mode}`,async()=>{
 const env=createTestEnvironment();const plugins=createMockPlugins(),agent=codex();const readActivity=agent.getActivityState.bind(agent);agent.getActivityState=async(s,t)=>s.id==='app-2'?{state:'active'}:readActivity(s,t);agent.recordActivity=undefined;
 const runtime={...herdr(),getOutput:vi.fn(async()=>''),getMetrics:undefined};const registry=createMockRegistry({runtime,agent}),sm=createSessionManager({config:env.config,registry}),lm=createLifecycleManager({config:env.config,registry,sessionManager:sm,projectId:'my-app'});
 try{for(const id of ['app-1','app-2']){const wt=join(env.tmpDir,id);mkdirSync(wt);writeMetadata(env.sessionsDir,id,{project:'my-app',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:wt,createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id:id==='app-1'?'w7:p1':'w7:p2',runtimeName:'herdr',data:{terminalId:'term_a'}})});}
 exec.mockImplementation(async(cmd:string,args:string[])=>{if(args[1]==='get'&&args[2]==='w7:p2')return {stdout:JSON.stringify({result:{pane:{pane_id:'w7:p2',terminal_id:'term_a'}}}),stderr:''};if(mode==='error')throw Error('unavailable');if(cmd==='herdr'&&args[1]==='get'){const pane={pane_id:'w7:p1',terminal_id:'term_b'};return {stdout:JSON.stringify(mode==='bare-pane'?{pane}:{result:{pane}}),stderr:''};}if(cmd==='herdr')return {stdout:JSON.stringify({result:{process_info:{pane_id:'w7:p1',foreground_processes:[]}}}),stderr:''};throw Error('unexpected '+cmd);});
 const listed=await sm.list('my-app');console.log('LIST',mode,listed.map(s=>({id:s.id,status:s.status,activity:s.activity})));
 const health=()=>readObservabilitySummary(env.config).projects['my-app']?.health['lifecycle.worker'];for(let i=0;i<2;i++){const before=health()?.correlationId;lm.start(3600000);lm.stop();await vi.waitFor(()=>expect(health()?.correlationId).not.toBe(before),{timeout:3000,interval:5});}
 const after=readMetadataRaw(env.sessionsDir,'app-1');console.log('AFTER',mode,after);expect(listed.find(s=>s.id==='app-1')?.status).toBe(mode==='well-formed-replacement'?'killed':'working');expect(after?.status).toBe(mode==='well-formed-replacement'?'killed':'working');
 }finally{lm.stop();vi.restoreAllMocks();env.cleanup();}
});
```

Insert in the existing `same-id-r4-strict-reads.test.ts` holder describe (the unchanged fixture makes app-1's runtime dead and its agent live):

```ts
it('review r3 duplicate __proto__ active record must hold cleanup', async () => {
  deadOpenCodeSession();
  writeFileSync(join(ctx.sessionsDir, 'app-2'), '__proto__=a\n__proto__=a\n');
  const result = await createSessionManager({config: ctx.config, registry: ctx.mockRegistry}).cleanup('my-app');
  console.log(result, api.remove.mock.calls);
  expect(api.remove).not.toHaveBeenCalled();
});
```

Actual: assertion fails with one call `['ses_shared',10000,undefined]`. To reproduce the older cleanup-note control instead, write `opencodeSessionId\n` and set `vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(false)` before cleanup. On base and tip it removes ses_shared; those assertions pass.

Insert inside the OpenCode `deliverMessage (I-5)` describe for m-2:

```ts
it('review r3 row 11 leading-zero PID stated positive safe integer', async () => {
  mockExecFileAsync.mockImplementation((cmd: string) => Promise.resolve({
    stdout: cmd === 'tmux' ? '/dev/pts/73\n' : '01 ?\n', stderr: ''
  }));
  const outcome = await withFakeTimers(() => agent.deliverMessage!(session(), TEXT));
  const err = (outcome as {error: Error}).error;
  expect(err).toBeInstanceOf(AgentNotAttachedError);
});
```

Actual: ordinary Error, `cannot check the OpenCode TUI of sess-1: ps -eo pid=,tty= answered a reply that is not a process list (first line "01 ?")`. The assertion follows the table's wording; the safe implementation behavior should remain and the table should be corrected.

Executed built CLI/status stand-in:

```js
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r3/live/status';mkdirSync(dir+'/bin',{recursive:true});mkdirSync(dir+'/repo',{recursive:true});
const clean={...process.env};assert.equal(clean.HOME,'/tmp/aor4r3/home');
writeFileSync(dir+'/bin/tmux',`#!/bin/sh
case "$1" in
 has-session) exit 0;;
 list-panes) if [ "$(/bin/cat '${dir}/mode')" = wrong-target ]; then echo "can't find session: unrelated" >&2; exit 1; fi; printf '/dev/pts/73\\n'; exit 0;;
 capture-pane) exit 0;;
 display-message) printf '1\\n'; exit 0;;
 list-sessions) exit 0;;
 *) echo 'review tmux stand-in refuses command' >&2; exit 97;;
esac
`,{mode:0o755});
writeFileSync(dir+'/bin/ps',`#!/bin/sh
mode=$(/bin/cat '${dir}/mode')
case "$mode" in
 error) echo 'review ps unavailable' >&2; exit 1;;
 malformed) echo 'procfs temporarily unavailable'; exit 0;;
 wrong-target) printf ' PID TT COMMAND\\n123 pts/73 /bin/bash\\n'; exit 0;;
 unsafe-pid) printf ' PID TT COMMAND\\n999999999999999999999 pts/73 /bin/bash\\n'; exit 0;;
 dead) printf ' PID TT COMMAND\\n123 pts/73 /bin/bash\\n'; exit 0;;
esac
exit 97
`,{mode:0o755});
process.env.PATH=dir+'/bin:'+clean.PATH;process.env.AO_STATE_ROOT=dir+'/state';process.env.AO_CONFIG_PATH=dir+'/config.yaml';
writeFileSync(process.env.AO_CONFIG_PATH,JSON.stringify({defaults:{runtime:'tmux',agent:'codex',workspace:'worktree',notifiers:[]},projects:{review:{path:dir+'/repo',repo:'review/scratch',sessionPrefix:'rv',defaultBranch:'main'}}}));
const core=await import(root+'/packages/core/dist/index.js'),paths=await import(root+'/packages/core/dist/paths.js');const config=core.loadConfig(),registry=core.createPluginRegistry();for(const p of ['runtime-tmux','agent-codex','workspace-worktree'])registry.register((await import(root+'/packages/plugins/'+p+'/dist/index.js')).default);
const sessions=paths.getSessionsDir(config.configPath,dir+'/repo');mkdirSync(sessions,{recursive:true});
const agent=registry.get('agent','codex'),original=agent.getActivityState.bind(agent);agent.getActivityState=(s,t)=>s.id==='rv-2'?Promise.resolve({state:'active'}):original(s,t);
const sm=core.createSessionManager({config,registry});
for(const mode of ['unsafe-pid','wrong-target','error','malformed','dead']){
 writeFileSync(dir+'/mode',mode);for(const id of ['rv-1','rv-2'])core.writeMetadata(sessions,id,{project:'review',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:dir+'/repo',createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id,runtimeName:'tmux',data:{}})});
 const before=core.readMetadataRaw(sessions,'rv-1');const cli=execFileSync(process.execPath,[root+'/packages/cli/dist/index.js','status','--json','-p','review'],{env:process.env,encoding:'utf8'});console.log('CLI STATUS',mode,cli.trim());assert.deepEqual(core.readMetadataRaw(sessions,'rv-1'),before);
 const lm=core.createLifecycleManager({config,registry,sessionManager:sm,projectId:'review'}),health=()=>core.readObservabilitySummary(config).projects.review?.health['lifecycle.worker'];try{for(let i=0;i<2;i++){const previous=health()?.correlationId;lm.start(3600000);lm.stop();const end=Date.now()+3000;while(health()?.correlationId===previous&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.notEqual(health()?.correlationId,previous);}}finally{lm.stop();}
 const after=core.readMetadataRaw(sessions,'rv-1');console.log('LIFECYCLE',mode,JSON.stringify({before,after,health:health()}));assert.equal(after.status,mode==='dead'||(process.env.REVIEW_OLD==='1'&&['unsafe-pid','wrong-target'].includes(mode))?'killed':'working');
}
console.log('LIVE STATUS COMPLETE');```

Built CLI/status results (both scripts exit 0 against their base/tip expectations):

```text
base status unsafe-pid: status=working, activity=exited
base status wrong-target: status=working, activity=exited
base status error: status=working, activity=None
base status malformed: status=working, activity=None
base status dead: status=working, activity=exited
base after two polls unsafe-pid: status=killed
base after two polls wrong-target: status=killed
base after two polls error: status=working
base after two polls malformed: status=working
base after two polls dead: status=killed
tip status unsafe-pid: status=working, activity=None
tip status wrong-target: status=working, activity=None
tip status error: status=working, activity=None
tip status malformed: status=working, activity=None
tip status dead: status=working, activity=exited
tip after two polls unsafe-pid: status=working
tip after two polls wrong-target: status=working
tip after two polls error: status=working
tip after two polls malformed: status=working
tip after two polls dead: status=killed
```

Host tmux/ps measurements:

```text
VERSION {'code': 0, 'stdout': 'tmux 3.4\n', 'stderr': ''}
START {'code': 0, 'stdout': '', 'stderr': ''}
OWN PIDS [2688397, 2688398]
LIVE {'code': 0, 'stdout': '/dev/pts/4\n', 'stderr': ''}
PREFIX MISSING {'code': 1, 'stdout': '', 'stderr': "can't find session: review-12\n"}
SET EXIT EMPTY {'code': 0, 'stdout': '', 'stderr': ''}
NO CURRENT {'code': 1, 'stdout': '', 'stderr': 'no current target\n'}
PS HEADER     PID TT       COMMAND
AFTER {'code': 1, 'stdout': '', 'stderr': 'no server running on /tmp/tmux-44402/aor4r3-forms\n'}
```

## Final isolation and cleanup audit

The required command (run read-only with the real path expanded):

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor4r3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-62
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

Every entry is external session state, not review test state:

- `sessions`: directory mtime 08:48:23.904717929 EDT, consistent with the real ao-52 record's atomic replacement below and the new real session. No review command wrote this directory.
- `sessions/ao-62`: real external session, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-62`, agent codex, branch `feat/sdr7-review-read-agent-task-md-in-your-worktree-and-execute`, createdAt `2026-10-22T12:31:10.597Z`, current status working. Its file mtime is 08:31:23.155799474 EDT. It was not spawned by this review.
- `sessions/ao-55`: real author session, its own worktree, status stuck, mtime 08:35:53.019204267 EDT. The real lifecycle log contains working-to-stuck transitions for ao-55.
- `sessions/ao-52`: real separate session, its own worktree, status stuck, mtime 08:48:23.904717929 EDT. The real lifecycle log likewise contains its working-to-stuck transition.
- `sessions/ao-orchestrator`: real primary-checkout session (`/home/taisung/local/agent-orchestrator`, branch main), status working, mtime 08:45:23.588006219 EDT. External lifecycle/hook/status activity explains this record; the real log also contains its status transitions. The review never read its pane or wrote its metadata.

The process list still shows real workers 2002324 (`ao lifecycle-worker agent-orchestrator`) and 2002831 (`ao lifecycle-worker agent-skills`). They, the external sessions and watchers were not signaled or modified. File mtimes alone cannot identify an individual writer; the attributions above use the separate session identities and real status log and do not claim a forensic PID trace. Every test/helper execution used the scratch HOME/TMPDIR/AO paths; the only built CLI calls were scratch `status --json` with stand-ins. No real AO CLI/config operation, network gh, model turn, real Herdr/OpenCode/agent call, ao send, commit or PR occurred.

After `ls -la --time-style=full-iso ~/.ao/bin` (byte-identical to the before listing):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final owned-process audit:

```text
Own processes excluding audit and ancestors: [] readable environments: 54
Known owned PID 2688397 exists False
Known owned PID 2688398 exists False
Private socket /tmp/tmux-44402/aor4r3-forms exists True
Private socket /tmp/tmux-44402/aor4r3-review exists True
```

Both exact private sockets answered `no server running` (exit 1). Owned server/pane PIDs 2688397 and 2688398 no longer exist. All Vitest/build/CLI/helper runs finished; no separate lifecycle worker was created. No patterned kill was used. The two exact inactive sockets `/tmp/tmux-44402/aor4r3-review` and `/tmp/tmux-44402/aor4r3-forms`, the scratch root `/tmp/aor4r3` and marker `/tmp/aor4r3-marker` were removed after retaining the evidence above. The author's `/tmp/aor4` was not modified.

Final tracked diff is empty. Worktree status contains only the untracked `.agent_task.md`, `.agent_report.md`, previous r2 review and this r3 review. This report is the completed review; no further review work is pending.
