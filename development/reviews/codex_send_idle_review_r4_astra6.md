# Codex idle send review, round 4 — ao-56

LAND-SAFE — whole range `09546110..f39d63db`, under owner decision 3a and the landing rule.

ccec6ee4: LAND-WITH-REST — retain `-p` as its own commit.

**0 blockers, 0 majors, 0 minors; 7 inherited follow-ups and 2 explicit nonblocking compatibility limits.** Round-3 M-1 is **fixed** for all six real captures, including the command + Tip layout. The earlier B-1/B-2/M-1/M-2 and test-independence m-1 fixes remain intact. New review range: `f9f34cc3..f39d63db`. Applied the previously read res-audit workflow; earlier review files remain unchanged.

This approves the specified status-block contract, not every possible Codex layout. The derived unknown-layout probes do expose a new active→idle change against the original baseline; they are not dismissed as pre-existing defects. The attribution and nonblocking judgment are explicit below.

## Isolation and evidence log

Marker `/tmp/aocsr4-marker`; scratch `/tmp/aocsr4/ao56`; fake HOME/PATH/TMPDIR, `env -i` on every helper/node/pnpm/test/CLI run. gh denies network operations. Private tmux names are separate for gates (`aocsr4-gates-ao56`) and replay (`aocsr4-live-ao56`). Replay config has a non-discoverable filename and is outside test temporary directories. No real agent, model turn, real-pane read, network gh or real-config AO call. Author report unread until independent items 1 and 2 finish. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Independent observations (before the author report)

- All six committed running fixtures are byte-equal to the read-only originals, with full SHA-256 verification. The built parser returns empty composer/running for all six; `detectActivity` and `recordActivity` → `getActivityState` return active. The latter uses a mocked live process, fresh workspace directories and no native Codex JSONL. The compiled `09546110` plugin also returns active for each.
- Exact prior R2 M-1/M-2 retain nonempty composers and read idle/not-running; R2 M-3 is waiting_input/not-running; B-2 remains active/running; the real idle capture is empty/idle/not-running. Private replay has already confirmed processing for all six running captures and not-submitted for M-1/M-2, with only initial C-u/text/Enter. Regular-send and remaining replay results follow below.
- All 16 combinations of 0–3 detail rows and 0–3 blank rows were checked independently: exactly 0–2 of each are accepted. Arbitrary text after the status, an intervening Worked-for row, and correctly indented status text inside the composer never confirm running. Arbitrary content beginning with `  └ ` does qualify as a detail: its origin is not checked.
- The wrapped-status, queued-row, three-detail, three-blank and interspersed-blank synthetic variants all return idle now versus active at `09546110`, including the recorded lifecycle fallback. This is a whole-range behavior change, not an old defect merely because round 4 did not introduce it. A status-shaped history block with arbitrary tool-style detail rows still returns active at both tips. Their landing significance is assessed separately below; these variants are derived screens, not additional real Codex captures.
- Clean scratch `git revert --no-edit ccec6ee4` succeeded as disposable commit `db4a70b5`; complete CLI 297 and Codex 280 tests pass without it.
- Mutant control: 223 plugin + 28 CLI tests pass. All four required mutants are killed: blank bound 1 (20 plugin/7 CLI failures), no detail rows (16/5), any intervening row (6/1), no approval priority (0/2).
- The first replay attempt completed captures 01/02, then raced the private server exiting after its last stub ended. No gate or real server was affected. Restarted the replay with an owned keeper process so its private server remains alive between cases; this is a harness correction, not a product failure.

## Block rule: attribution and landing judgment

Independent built-module probes used `S = "• Working (8s • esc to interrupt)"` and `P = "› Ask Codex to do anything\n\n  Context 68% used\n  ? for shortcuts\n"`. These are derived screens. `S + "\n\n\n" + P` has two blank rows, not three. Both baseline and HEAD were executed, including real scratch activity files and `getActivityState` with mocked liveness/no native JSONL.

| Limit / reproducer above P | 09546110 detector + lifecycle | HEAD detector + lifecycle; regular idle wait; verification | Attribution and decision |
|---|---|---|---|
| Wrapped: `• Working (8s • esc to\n  interrupt)\n\n\n` | active; waits | idle; sends immediately; could-not-confirm | **L-1, new whole-range compatibility risk.** Not an old defect. No real capture establishes that Codex renders this wrapped layout rather than truncating or relocating it. Not blocking this bounded 3a contract. |
| Queued row: `S + "\n  › queued message\n\n\n"` | active; waits | idle; sends immediately; could-not-confirm | **L-1**, same judgment; the actual placement/layout of a queued message remains unverified. |
| Three details: `S + "\n  └ command\n  └ output\n  └ Tip: help\n\n\n"` | active; waits | idle; sends immediately; could-not-confirm | **L-1**, newly rejected vs base, explicitly outside the capture-derived bound. No observed supported block exceeds two. Not blocking the specified bound. |
| Three blanks: `S + "\n\n\n\n"` | active; waits | idle; sends immediately; could-not-confirm | **L-1**, same attribution and decision. Interspersing a blank between two detail rows also rejects, as the specified order requires. |
| History-shaped block: `S + "\n  └ tool failed; no turn runs\n  └ arbitrary output\n\n\n"` | active; waits; old verification would say processing | active; waits, then processing after timeout | **L-2, ambiguity in changed code**, widened relative to round 3 but not a new active answer vs base. It is not exempt merely because base also misreads it. A byte-identical status block cannot reveal whether its text is historical; no real completed-turn capture exhibits this adjacency. Not blocking 3a's chosen structural evidence. |

**L-1 location/category:** `packages/plugins/agent-codex/src/codex-screen.ts:153`, `index.ts:425`, and `packages/cli/src/commands/send.ts:321`; compatibility / uncertainty handling. The author left `runningTurn ? active : idle` in changed code, so an unrecognized *actual* running layout would indeed be a regression eligible to block the whole range. Mere failure to confirm running is not affirmative evidence of idleness. The no-native-JSONL lifecycle fallback records idle immediately, and the regular send skips Waiting, even though post-send verification remains cautious. This review does **not** read 3a as explicit approval of all those consequences. It finds no demonstrated current layout beyond the owner-selected bounds, so retains this as an explicit risk requiring a real-layout post-landing check, rather than inventing a fresh supported-layout failure from the synthetic screen. Native JSONL, when available, still takes precedence; the terminal fallback was tested separately.

**L-2 location/category:** `codex-screen.ts:155–159`; provenance ambiguity / confirmation confidence. Any two-space `└ ` row qualifies, including arbitrary tool output, not just a Tip or command. The synthetic block gives processing, so the prose claim that transcript text *never* counts must be understood as excluding a full structurally indistinguishable block; the docs' limits section states that exception. By contrast, `S + "\n  └ tool failed\n  Worked for 1s\n\n" + P`, an ordinary intervening text row, and a correctly indented block inside the composer all give not-running/idle/could-not-confirm. The captured idle panes retain the Worked-for boundary. A real completed pane exhibiting the indistinguishable block would warrant reopening this, not citing the baseline as an exemption.

There is no landing-blocking B-/M-/m-series finding this round. L-1/L-2 are new review risk notes, distinct from the seven older follow-ups. The six-capture regression is fixed, not merely hidden by a looser word scan. Neither undocumented layouts nor an existing turn's status are proof that this particular message was received.

## Gates and scratch checks

All invocations used the isolated environment above. Worktree gates: frozen install, build, filtered CLI/Codex tests, lint (0 errors, 5 pre-existing warnings), typecheck, and one full `pnpm -r --no-bail test` all exit 0. The full run had no source or harness failures. Its summary lines:

```text
packages/core test:       Tests  1392 passed | 4 expected fail (1396)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  280 passed (280)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:       Tests  38 passed (38)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:       Tests  52 passed (52)
packages/plugins/workspace-worktree test:       Tests  65 passed (65)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  297 passed (297)
```

Total: **3026 passed, 4 expected fail, 29 skipped**. Filtered suites: CLI 22 files/297 tests; agent-codex 5 files/280 tests. Scratch revert: the same counts, exit 0.

`SAME_ID_DEFECTS=red` ran all ten applicable files, including `agent-opencode/src/same-id-reuse-window.test.ts`: **R1 0, R2 8, R3 6, R4 11** failures (25; 17 controls pass). These match this reviewer’s actual `09546110` baseline run from round 1; this round reran HEAD, not the baseline red suite.

## Mutation checks

Scratch archive of f39d63db, restored before each mutation. Focused commands: `pnpm exec vitest run src/codex-screen.test.ts src/index.test.ts` in agent-codex; `pnpm exec vitest run __tests__/commands/send-codex.test.ts` in CLI. Control: **223 + 28 pass**. No worktree mutation. Test names below omit only shared describe prefixes; capture ranges expand to separate tests.

| Mutation | Plugin failures | CLI failures |
|---|---|---|
| blank1 | 20 | 7 |
| noDetails | 16 | 5 |
| anyRow | 6 | 1 |
| noApproval | 0 | 2 |

**blank1** — failing tests:

- plugin: `reads real running capture 01,02,03,04,05,06: an empty composer below the status block, a running turn`
- plugin: `reads a running turn from the status block: the status row, up to two └ rows, up to two blank rows`
- plugin: `returns active for real running capture 01,02,03,04,05,06, and the parser reads a running turn`
- plugin: `reads the running-turn row only in the status block directly above the composer`
- plugin: `records and returns active for real running capture 01,02,03,04,05,06 (no native JSONL)`
- cli: `prints processing for real running capture 01,02,03,04,05,06 with --no-wait, and sends no key`
- cli: `waits for real running capture 01 in a regular send and pastes only after the timeout`

**noDetails** — failing tests:

- plugin: `reads real running capture 02,03,04,05,06: an empty composer below the status block, a running turn`
- plugin: `reads a running turn from the status block: the status row, up to two └ rows, up to two blank rows`
- plugin: `returns active for real running capture 02,03,04,05,06, and the parser reads a running turn`
- plugin: `records and returns active for real running capture 02,03,04,05,06 (no native JSONL)`
- cli: `prints processing for real running capture 02,03,04,05,06 with --no-wait, and sends no key`

**anyRow** — failing tests:

- plugin: `reads no running turn past the bounds of the status block`
- plugin: `reads no running turn when a row of another kind is between the status row and the composer`
- plugin: `reads no running turn for a status-row text in a transcript row above a 'Worked for' row or a text row`
- plugin: `reads the running-turn row only in the status block directly above the composer`
- plugin: `returns idle for a status block with a row of another kind above the composer`
- plugin: `reads no running turn above a 'Worked for' row, also when the composer text quotes a prompt row`
- cli: `prints the could-not-confirm line for a status row with a row of another kind above the composer`

**noApproval** — failing tests:

- cli: `review r2 M-3: an approval prompt prints the approval line, not processing, and sends no key`
- cli: `asks detectActivity first: an approval prompt wins over a status row above the composer`

All four mutants are killed. `anyRow` replaces the constrained block walk with a six-row backward search accepting any intervening row; it deliberately tests that unrelated rows cannot be skipped. `noApproval` removes only the Codex verify-branch waiting_input check.

## Commit and integration checks

Other-agent loop through EOF and generic rescue helper byte-equal to 09546110.  
15 commits: linear, conventional subjects, explanatory bodies, no coauthor trailers, emoji or issue numbers.  
git branch -r --contains f39d63db: ""  
Three-way merge-tree: clean  


The merge-tree check is read-only (three explicit tree arguments); no merge, source commit or branch operation was performed. Same-ID R2a contributes its separate metadata/lifecycle/runtime changes. Its docs change remains separate from the Codex send section; the clean merge does not substitute for rebuilding and running integration gates after landing both.

## Private replay and fixture provenance

The built worktree CLI ran against raw Python stubs on `aocsr4-live-ao56`, with scratch session records resolving agent=codex, scratch AO_STATE_ROOT and replay.yaml. Stubs enabled bracketed paste and held each screen unchanged. Panes were 180×45: all six 24-row running captures fit; the long idle transcript is cropped at the top, retaining its complete composer/footer. This is terminal replay, not a real agent/model turn. Commands were `node <worktree>/packages/cli/dist/index.js send --no-wait r4-case-N -f <message>` or regular `send --timeout 1 ...`.

All **26 cases** exit 0; before/after panes are identical. Every complete byte log equals exactly `C-u + text + Enter`, with bracketed markers for multiline messages; no other byte, including a verification key, occurs. The timeout loop polls at 5 s, so a 1 s timeout expires on that next poll.

| Cases | Observed result | First key after CLI start |
|---|---|---|
| Six running captures, no-wait | processing | 0.30–0.35 s |
| Six running captures, regular send | Waiting → timeout → processing | 5.32–5.37 s |
| R2 M-1 / M-2 | not submitted / not submitted | 0.30 s |
| R2 M-3 | approval line | 0.30–0.35 s |
| Old B-2 | processing | 0.30–0.35 s |
| Real idle | could-not-confirm | 0.30–0.35 s |
| Wrapped / queued / 3 details / 3 blanks / interspersed blanks, regular | no Waiting; could-not-confirm | 0.30–0.35 s |
| History-shaped full status block, regular | Waiting → timeout → processing | 5.32 s |
| Worked-for boundary / ordinary intervening text / quoted composer block, regular | no Waiting; could-not-confirm | 0.30–0.35 s |

Originals: `/home/taisung/.cache/agent-skills-haiku55-arc/fixtures/`. Full SHA-256 of committed bytes, independently equal to each original:

```text
codex-0.163.0-running-01.txt 163a64fda972956dde445060c2f73e7f9c04d4480e2c26807fefd6ecf70dae4d
codex-0.163.0-running-02.txt 773f637c87ee9413338bab5de8870ac0bee93dd45fd2e9582550c0d38fedc9ef
codex-0.163.0-running-03.txt a0ab7ca85a162e361cfa1b2f3afc30dfd31f9699b5ca0047fc751c27d098f821
codex-0.163.0-running-04.txt 10b1b6f3a6b2c378ae3fc957021d6e8c6e6557b4c4033000b22e1284af48ef84
codex-0.163.0-running-05.txt 172ac0e023d699e4cf29b4b0c8189fbc4dcc24ae1fa725cf76c8781a0e434a8b
codex-0.163.0-running-06.txt 613096c7c0c3d2b6305b6c8b17260c3499a9cb3e26c289cc56628c55cff73cba
```

Opened the author’s round-4 report only after all independent item 1/2 checks and replays completed. Its six-capture, gate, mutant and limitation claims agree with these runs. The baseline attribution above is independent: “unchanged since round 3” does not make L-1 a pre-existing baseline defect.

## Follow-ups carried from the earlier reviews

| ID | Older defect / limitation; why it is not a new landing blocker |
|---|---|
| F-1 | Approval coverage is incomplete; the old literal `approval required` predicate also matches message text. Owner-required waiting_input priority correctly surfaces that predicate. Complete recognized selection lists remain excluded; no actual uncaptured menu layout is claimed covered. |
| F-2 | Generic extra-Enter retries and the Codex-named rescue helper remain for other agents, byte-equal to base. A correctly resolved Codex agent cannot reach that loop. |
| F-3 | The old queued-message phrase matcher does not match all current Codex wording. Distinct from L-1's newly rejected hypothetical queue placement. |
| F-4 | The shared unnamed tmux paste buffer and timestamp-named temporary file leave concurrent-send races. `-p` does not create or resolve them. |
| F-5 | Old activity-log refresh behavior can keep an idle/stuck threshold from expiring. The six real running panes now record active again; L-1 separately records the changed classification risk. |
| F-6 | An already-running turn does not prove receipt of the just-sent message. 3a explicitly asks for processing for that visible status; private unchanged-screen replays demonstrate the confidence limit. |
| F-7 | Failed/missing session resolution defaults to Claude Code, so an actual Codex pane can take the other-agent loop. This predates the range; no new screen rule sends a correctly resolved Codex through it. |

## What is correct and the post-landing check

- One shared parser recognizes the actual two-blank-row layout, Tip and command details; all six real screens agree across verification, detection and terminal-derived lifecycle state.
- Exact prior failure reproducers keep their corrected outcomes. Recognized approval wins at every verification check; an empty composer alone never proves delivery; the resolved Codex branch sends no verification key and keeps exit 0.
- The tests catch both loss of real-layout recognition and an overbroad scan through unrelated rows. Complete suites still pass after removing `-p`; transport and parsing are separable.
- `ccec6ee4` may land with this range as its own commit. Its original private byte/order evidence remains applicable; this round additionally verifies exact multiline bracketed bytes and no retry key. If it is omitted or reverted, change the transport documentation accordingly.

After landing this range beside same-ID R2a, rebuild the primary checkout and run the combined gates once. Feed all six preserved captures through the rebuilt parser/detector: all must be running/active. Preserve exact R2 M-1/M-2/M-3 and B-2 controls. The clean merge-tree is not a combined live test.

The orchestrator should then use a disposable real Codex 0.163.0 session for short, >200-character and multiline sends, checking the pane and transcript rather than relying on the processing line alone. On an idle session, confirm no unnecessary Waiting line. On a running session, a regular send must enter Waiting before any message byte; let the turn finish within the timeout and verify delivery. For a deliberate mid-turn no-wait send, verify only the initial Enter. A retained paste must say not-submitted, an empty unconfirmed pane could-not-confirm, and recognized approval the approval line; inspect message ownership before manually pressing Enter.

Capture a narrow pane and a real queued-message layout, including the full status/composer/footer. Check L-1 against actual rendering before widening operational use. If a live layout reads idle while the turn runs, reopen the whole-change regression and separate unknown layout from confirmed idle for the wait; do not silently broaden processing to arbitrary words. A real finished pane matching L-2 likewise reopens confirmation correctness. Retain failed captures as tests. These real-agent checks were not performed by this reviewer.

## Final isolation and cleanup audit

All finite build/test/CLI helpers exited. Raw stubs and the keeper/private server were stopped using their exact recorded PIDs. The replay harness printed three PIDs immediately after signalling them; a subsequent exact-PID check found them gone. Final audit of 417 recorded helper/live PIDs and scratch-named commands, excluding only the audit helper and its ancestors:

```text
Own live processes: []
```

Both private sockets have no live server. No default-server command, pattern kill, protected-session action or signal to a protected PID occurred. The initial install used the fake-HOME pnpm store; before deleting scratch, a frozen offline install relinked worktree dependencies to the existing permanent store (`/home/taisung/.local/share/pnpm/store/v3`), reusing 379 packages with 0 downloads. No lockfile/source change.

Required command immediately before cleanup:

```text
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aocsr4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
```

Every entry is external fleet state, not a reviewer write:

- `sessions/ao-54`: generation=23; status=stuck; agent=claude-code. The real lifecycle log includes its working→stuck transition.
- `sessions/ao-55`: generation=24; status=working; agent=claude-code. External worker/session metadata changed while this review ran. Its prior stuck transitions are in the real log; the log does not prove which process wrote the later working update.
- `sessions`: its mtime matches the latest atomic replacement of ao-54. All 26 reviewer CLI calls used isolated scratch config/state, so none targeted this directory. These are attribution evidence, not a syscall trace identifying the exact external writer.

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions | 2026-10-21 21:44:37.960187052 -0400 | 4096 bytes
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55 | 2026-10-21 21:42:08.176679500 -0400 | 678 bytes
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54 | 2026-10-21 21:44:37.960187052 -0400 | 681 bytes
```

`ls -la --time-style=full-iso ~/.ao/bin` after, byte-identical to the before listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Removed `/tmp/aocsr4/ao56` (archives, disposable revert commit, activity files, replay config/state, fake HOME/store, logs, stubs and helpers), its empty parent, `/tmp/aocsr4-marker`, and only the stale sockets `aocsr4-live-ao56` and `aocsr4-gates-ao56` under `/tmp/tmux-44402`. The author scratch and real capture originals remain untouched. `git diff --exit-code` and the staged equivalent pass; HEAD remains f39d63db. No worktree source edit, commit, push, PR, real agent, model turn, network gh or real-config AO call. Prior review files remain untouched; earlier reports are retained below the new body. Final report is published atomically after cleanup.
