# Same-ID R4 round 4 review

LAND-SAFE for the whole of R4, `75f1c98b..e3860672`: **0 B, 0 M, 0 m**. Review-r3 M-1, m-1 and m-2 are closed. No new finding meets the rule “made, worsened, or retained in code changed by R4.” F-1 through F-7 remain separate follow-ups.

Reviewed on `review/same-id-r4-r4`, tip `e38606721747b0e27343ff7a2df2c86decd1794d`, focused delta `c02c0c02..e3860672`. This is a re-check of round 4, combined with the retained r3 review of the earlier R4 changes. The author brief was read in full; the current author report (lines 1–473, historical reports below) was read only after independent closure checks. No production edit, commit, rebase, pull, push or PR.

## Closure and independent checks

| R3 finding | Result | Source and independently measured behavior |
| --- | --- | --- |
| M-1, top-level Herdr pane | Closed | `runtime-herdr/src/index.ts:99,139,219,249`: only pane-get calls the parser with `requireResult`. Absent/null/scalar/list results cannot supply a pane through the top-level fallback. `isAlive` rejects; session-manager list and two lifecycle polls retain working. |
| m-1, duplicate `__proto__` | Closed | `core/src/key-value.ts:32,41,44`: a separate Set records keys before assigning the value. Same-value and different-value duplicates throw. The original cleanup fixture calls removal zero times and retains app-1. |
| m-2, row-11 PID wording | Closed | `docs/DEVELOPMENT.md:478` now says “without a leading zero” and explicitly rejects `01`. The unchanged OpenCode reader at `index.ts:719` rejects it. The send probe, with assertions for the corrected contract, passes on both revisions. |

Replayed the r3 review's 83-case boundary suite and its session-manager/two-poll caller, extending the latter to null/scalar result as required. The source is retained in [review r3](same_id_r4_review_r3_astra6.md), “Reproduction appendix”; only scratch paths, the extra two caller modes and output capture were added.

```text
83 boundary cases + 5 caller cases:
  c02c0c02: 80 passed, 8 failed
  e3860672: 88 passed, 0 failed
Original duplicate-__proto__ cleanup fixture:
  c02c0c02: 0 passed, 1 failed
  e3860672: 1 passed, 0 failed
Additional round-4 boundaries and compatibility checks:
  e3860672: 31 passed, 0 failed
Selected controls on c02c0c02: 13 passed, 0 failed
Leading-zero OpenCode send probe, corrected-contract assertions:
  c02c0c02: 1 passed; e3860672: 1 passed
```

The eight original failures are exactly three malformed envelopes, two duplicate records and three caller cases. Inputs for handle `{id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}}` are `{"pane":{"pane_id":"w7:p1","terminal_id":"term_b"}}` and that object with `result:null` or `result:12`. On the base, each `isAlive` resolves false; on tip, each rejects. A second session has a valid live answer so the two-poll probe does not hit the older global-outage bound.

```text
mode                    base list/status after two polls     tip list/status after two polls
bare-pane               killed / killed(runtime), gen 2     working / working, gen 1
null-result             killed / killed(runtime), gen 2     working / working, gen 1
scalar-result           killed / killed(runtime), gen 2     working / working, gen 1
wrapped replacement     killed / killed(runtime), gen 2     killed / killed(runtime), gen 2
command error           working / working, gen 1            working / working, gen 1
```

The independent agent reply is a valid empty process list, so the tip list's activity is still `exited` for the three malformed runtime envelopes; the session status remains working and the failed runtime probe prevents persisting death. This distinction is intentional and matches the lifecycle gate. Wrapped replacement and lone `pane_not_found` stay false; the author's lifecycle controls for both negatives pass in the normal suite.

The parser inputs `__proto__=a\n__proto__=a\n` and `__proto__=a\n__proto__=b\n` return `{}` on the base and throw on tip. The original cleanup fixture writes the first as app-2's record, with app-1's runtime dead but its agent live:

```text
base: removal calls = [['ses_shared',10000,undefined]]
      killed=[app-1,app-2], skipped=[], app-1 record=null
 tip: removal calls = []
      killed=[app-2], skipped=[app-1], app-1 status=working,
      opencodeSessionId=ses_shared, generation=1
```

Ordinary duplicate `opencodeSessionId` still throws. One `__proto__` line still returns `{}` with `Object.prototype`; it names nothing and does not change the prototype. New cases cover duplicate `constructor`, `toString`, `hasOwnProperty` (same and different values), list results both empty and containing a pane, `result:{}`, non-object panes (null, number, string, array, boolean), and an error together with a result object. All reject as required.

Other parser callers preserve compatibility: `workspace create` still accepts its former top-level workspace/root-pane answer; run/close/prompt/send-text/send-keys keep the ordinary parser and ignore their result. The shared `getPane` used by send waits is intentionally stricter: it catches the pane-get rejection as “not yet.” An independent fake-timer test feeds a bare pane, then wrapped idle and working panes: four reads, one agent prompt, no raw fallback, successful delivery. No new destructive interpretation is introduced. Blank/non-JSON/scalar top-level replies also reach the existing “without a pane” rejection, even though the parser's early branches precede the new guard.

## Table, scope and commits

Rows **3, 4, 9 and 11 agree** with the checked code and controls. Active and archived duplicates are held, pane-get requires a result object (except the explicit error-envelope negative), and leading-zero PIDs are unknown. New named tests exist and execute in the core/runtime suites; the archive cleanup test also fails under the parser mutant. Rows **1, 2, 5, 6, 7, 8 and 10** compare equal after whitespace normalization: their diff is padding only. Checked both the word diff and normalized row contents. The older cleanup/kill-route note remains unchanged and correct within the r3 evidence.

Exactly seven allowed files changed, +322/-20. Existing tests have zero deleted/replaced lines; all changes are additions, including the new lifecycle file. `parseKeyValueContent` and every pre-existing line outside the strict function are byte-equal. Precise scope qualification: two new explanatory lines occur in the strict function's adjacent JSDoc, before its declaration; I treat that JSDoc as documentation of the allowed function, not unrelated code. There is no outside-function behavior change. The author's “only strict function” claim includes this comment. Claude source is untouched by R4.

```text
f5c9a400  fix(herdr): take a pane get answer only from a result object
8fd6663c  fix(core): hold a record that sets __proto__ twice
e3860672  docs: make rows 3, 4, 9 and 11 of the absence table exact
```

Three single-parent commits, directly chained from c02c0c02. Each has a substantive WHY body, conventional title, no trailer, emoji or issue number. `git branch -r --contains e3860672` prints nothing (exit 0).

## Mutation checks

Scratch only; test aliases read that copy's source. Each mutation was run separately, then the production file restored and compared byte-equal to the worktree. The corresponding unmutated package gates pass.

| Mutant | Result | Tests that fail |
| --- | --- | --- |
| Restore top-level fallback by removing the `requireResult` guard | 57 passed, 7 failed | Four direct malformed-envelope cases and three two-poll cases. |
| Restore `Object.hasOwn(result,key)` duplicate check | 76 passed, 4 failed | Both duplicate-`__proto__` metadata cases and active/archive cleanup. |

Exact failed test names:

```text
isAlive(): a pane outside a result object is unknown rejects a top-level pane without a result (review r3)
isAlive(): a pane outside a result object is unknown rejects a top-level pane with a null result (review r3)
isAlive(): a pane outside a result object is unknown rejects a top-level pane with a scalar result (review r3)
isAlive(): a pane outside a result object is unknown rejects a top-level pane with a list result
same-id R4 round 4 (review r3, M-1): the lifecycle with the real runtime-herdr plugin keeps app-1 working over two polls when herdr answers a top-level pane without a result (review r3)
same-id R4 round 4 (review r3, M-1): the lifecycle with the real runtime-herdr plugin keeps app-1 working over two polls when herdr answers a top-level pane with a null result (review r3)
same-id R4 round 4 (review r3, M-1): the lifecycle with the real runtime-herdr plugin keeps app-1 working over two polls when herdr answers a top-level pane with a scalar result (review r3)
readMetadataStrict / readArchivedMetadataStrict (same-id R4 round 3, M-5) throws for the key __proto__ twice with one value (review r3)
readMetadataStrict / readArchivedMetadataStrict (same-id R4 round 3, M-5) throws for the key __proto__ twice with two values (review r3)
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 4 (review r3, m-1): a malformed active record with the key __proto__ twice keeps the session, with the holder reason
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name round 4 (review r3, m-1): a malformed archive record with the key __proto__ twice keeps the session, with the holder reason
```

## Gates and combination with main

All commands run under `env -i` through `/tmp/aor4r4/run`, with scratch HOME/TMPDIR/AO paths, HUSKY=0, no agent binary on PATH and a gh stub. Frozen install, build, `pnpm lint` and `pnpm typecheck` exit 0. Lint: 0 errors, the same five existing warnings. Build precedes dependent tests.

The first filtered run had six `paths.test.ts` failures because my harness used `/tmp/aor4r4/state`, whereas those assertions require a `.agent-orchestrator` basename. Corrected to `/tmp/aor4r4/home/.agent-orchestrator`; the full filtered rerun passes without a source/test edit. This was a harness failure, not discarded product evidence. Initial caller console output was not retained by the JSON reporter; a second targeted run wrote exact records/calls to scratch files before assertions.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @aoagents/ao-core --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-cli test
pnpm lint
pnpm typecheck
pnpm -r --no-bail test
```

Corrected filtered run (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1616 passed | 1 expected fail (1617)
packages/plugins/runtime-herdr test:  Test Files  4 passed (4)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

Full recursive run (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1616 passed | 1 expected fail (1617)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  247 passed (247)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/runtime-herdr test:  Test Files  4 passed (4)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

The core expected failure, integration's 24 real-binary skips and SCM's five skips are not represented as passing tests. All 14 defect/reuse-window files ran with `SAME_ID_DEFECTS=red`, core aliased to worktree source: exit 1 as expected, **70 passed / 22 failed / 0 skipped**. R1 17 passed / **0 failed**; R2 20 passed / **16 failed**; R3 0 passed / **6 failed**; R4 33 passed / **0 failed**.

Clean three-way combination, no checkout merge:

```text
main captured: 3ca63e9765fb9ad9bf7a4fe677ea31027e85e34a
R4 tip:        e38606721747b0e27343ff7a2df2c86decd1794d
merge base:    75f1c98be3b45b37c51cc8eb665f0d01149a55e7
merge tree:    cad263bbcb3dbb55934d9f34fb242ff6ad185942
```

`git merge-tree --write-tree main e3860672` exits 0. Archived that tree to `/tmp/aor4r4/merged` with dependency links to its own workspace packages, built it (exit 0), then ran core, runtime-herdr, agent-claude-code and CLI (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1616 passed | 1 expected fail (1617)
packages/plugins/runtime-herdr test:  Test Files  4 passed (4)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/cli test:  Test Files  23 passed (23)
packages/cli test:       Tests  323 passed (323)
```

## Follow-ups and what is correct

- F-1: R2b runtime launch/server identity, default-socket ambiguity and old no-server/outage bounds.
- F-2: R3 operation/workspace/OpenCode ownership serialization; its six red failures remain.
- F-3: Cleanup selecting the project runtime rather than always the stored handle's runtime.
- F-4: Older missing/malformed runtime-handle and unloaded-plugin guards in kill/recovery.
- F-5: Lenient `findLiveOpenCodeSessionHolder` and other old holder/removal routes, including r3's confirmed both-self-dead cleanup/kill case, orchestrator delete, archived purge and failed-launch/ledger namers as applicable. No new concurrency or both-dead experiment claimed here.
- F-6: Claude `findClaudeProcess` malformed-success handling; separate work, outside this R4 delta.
- F-7: Unchanged OpenCode `readProcessArgv` maps every `/proc` read failure to null. Row 11 discloses that limit; no real OpenCode/proc-permission experiment here.

Correct: the result-envelope gate closes false runtime death while retaining explicit negatives; the seen-key Set closes the duplicate hole without changing lenient parsing or one-line compatibility; send waits preserve uncertainty; existing test oracles remain intact; table wording matches the repaired boundaries; mutant sensitivity, normal gates, red counts and the clean combination all support landing. These claims are limited to R4, not closure of the older follow-ups.

## Final isolation audit

Marker: `/tmp/aor4r4-marker`, 2026-10-22 09:28:37.304234327 EDT. Every executable helper/test/git call used the scratch environment; no real AO config/state operation, network gh, model turn, real agent/Herdr/OpenCode process, ao send, or default tmux call occurred. All process probes in the independent tests are mocked. Integration used only the private `aor4r4-review` server (including when a test supplied its own scratch socket directory).

Harness audit correction: the initial tmux shim inherited the **scratch-only** AO_STATE_ROOT/AO_CONFIG_PATH rather than stripping all AO variables as required. I replaced it with `env -i` before tmux (fake HOME/TMPDIR/PATH, preserving only its scratch socket-directory setting), then reran integration: exit 0, 10 files passed / 3 skipped, 91 tests passed / 24 skipped. No real AO values were inherited in either run. The private server was already gone before this rerun and is gone afterwards.

Required real-state check, read-only:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor4r4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
```

Every printed entry is explained:

- `sessions/ao-55`: the external author session, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-55`, agent claude-code, current status stuck, generation 49. File mtime 2026-10-22 09:35:25.154461940 EDT. The real lifecycle log contains its working-to-stuck transition. This review did not write its record.
- `sessions`: directory mtime is exactly the same as ao-55's record, consistent with the real worker's atomic record replacement. No test or helper used this directory. This is attribution to external lifecycle activity, not a claim that mtime alone identifies a writer PID.

Real workers 2002324 (`ao lifecycle-worker agent-orchestrator`) and 2002831 (`ao lifecycle-worker agent-skills`) remain present. They, external sessions and watchers were not signaled; the orchestrator pane was not read. No separate lifecycle worker was started. The test processes ended; the private tmux server and panes ended through test teardown. No manual process kill was needed.

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

After the same command (byte-identical):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final process/server audit:

```text
Owned processes excluding audit and ancestors: [] readable environments: 64
private aor4r4-review list-sessions: exit 1, no server running on /tmp/tmux-44402/aor4r4-review
```

After retaining this evidence, removed the exact inactive socket `/tmp/tmux-44402/aor4r4-review`, `/tmp/aor4r4` and `/tmp/aor4r4-marker`. The author's `/tmp/aor4` was not modified. Tracked worktree diff is empty; untracked task/report and prior r2/r3 reviews remain, together with this r4 review. The final report is published atomically with earlier reports preserved below it.
