# Herdr fit-2a code review r1 (muse 1.3) — 2026-10-23

Scope: `36caf8a9..a999a78f` (ao-73, fit-2a, 6 commits). Design: `development/reviews/herdr_fit2_design_r11_opus.md` r11; check: `herdr_fit2_design_review_r11_sol61.md` (m-1, m-2 required).

## Verdict: LAND-SAFE

No blocking and no major findings. 5 minors (text/robustness/test-noise, all reasoned deviations or equivalent code). Gates pass as the implementer reports (core 1847+1xfail, runtime-herdr 261, cli 447, red set = base 21, lint 5 known, gitleaks clean, merge-tree no conflicts). All 16 deviations are inside the design goal; all 4 open questions need no code change for fit-2a.

## Isolation and branch

- Branch verified at `a999a78f` (`git log --oneline -1`); base `36caf8a9`; never used `origin/main`, pull/fetch/rebase/commit.
- `touch /tmp/aof2am-marker` at start; `ls -la --time-style=full-iso ~/.ao/bin` at start (below) exactly matches the end listing (same 4 files, sizes, modes, times):
```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815775503 -0400 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```
- Scratch: `git archive a999a78f | tar -x -C /tmp/aof2am/scratch-tip`, `git archive 36caf8a9` to `scratch-base`. PATH `/tmp/aof2am/bin` with links only (node, pnpm wrapper on cached 9.15.4, git, sh, bash, readlink/flock/jq/timeout + coreutils; gh stub answering only `--version`/`auth status`; tmux shim adding `-L aof2am-tests` unless `-S` present). No `/usr/bin` on PATH, no agent binary, no herdr, no npx/npm on PATH. Every `pnpm`/`node`/test ran as `env -i HOME=/tmp/aof2am/home TMPDIR=/tmp/aof2am/tmp PATH=/tmp/aof2am/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true ...` with `--store-dir=/home/taisung/.local/share/pnpm/store/v3` for install. No `ao` command, no `opencode` command/API, no `gh` network call, no tmux on default server (only `env -u TMUX tmux -L aof2am-<name>`), no real claude/codex/gemini/opencode/herdr process, no kill except listing PIDs, no stash/worktree, no writes outside this review file + `.agent_report.md`.

## Findings

### B (blocking): none

No Herdr path closes/deletes/overwrites a foreign resource or record, publishes into another launch's record, clears another launch's claim, starts a second agent for one session, or regresses tmux/another runtime. Evidence under gates and sections 2.1–2.9.

### M (major): none

Every 8.1 design rule is followed; every risky rule (claims/settlement, `publishOwnLaunch`, restore, dispatch) has a failing test for each wrong mutant (report D2, spot-checked below). The 19 tests that pass on the base are controls/consumer pins/base-lacks-mechanism with D2 evidence (section 2.11).

### m (minor)

#### m-1 — `waitForSettledAgent` needs `pane.agent` to report `blocked`
- File: `packages/plugins/runtime-herdr/src/index.ts:459`: `if (pane?.agent && pane.agent_status === BLOCKED_STATE) return BLOCKED_STATE;`
- Spec 5.1: "stops at the first poll that shows `blocked`" (no agent qualifier); T-3.1–T-3.4 all set an agent name.
- Evidence: a `blocked` status with no agent name would fall through to the `SETTLED_STATES` check (`:460`), then timeout to `null`, then the `send-text`/`send-keys` fallback (`:795-797`) — a prompt to a blocked agent, the exact F-3 violation, with zero refusal.
- Reproducer (not run live; code reading + fixtures): stand-in `pane get` returning `{agent_status:"blocked"}` with no `agent` field. All recorded fixtures carry an agent when blocked, and herdr practice implies `blocked` has an agent, so reachability is unlikely. Fix: test `agent_status` alone for `BLOCKED_STATE`, or document the agent precondition. Minor robustness/test gap, not blocking.

#### m-2 — CLI `sendThroughAgent` has no blocked-refusal line
- File: `packages/cli/src/commands/send.ts:238-254` (`sendThroughAgent`): catches any error as `Message not sent to <session>: <detail>`, exit 1, no `isRuntimeSendRefusedError` branch. The Herdr CLI path (`:444-456`) correctly maps to `blockedSendLine` (`:221-230`) with exit 1, stderr only, no stack.
- Evidence: core `send` routes OpenCode-with-stored-ID via agent API (`session-manager.ts:4906-4924`) before `runtime.sendMessage`; a Herdr+OpenCode session taking the `deliver` route would never hit `runtime-herdr sendMessage`, so F-3 refusal cannot occur there — the generic line is then correct for an API failure, but a future runtime refusal bubbled through `deliver` would lose the blocked text.
- Reachability today: Herdr launches store `opencodeSessionId` for the OpenCode shape (`launchedRecordFor`), so the route is possible; no test covers blocked+deliver. Design 5.2.6 keeps send policy as-is (OQ-F5 a), and F-3 scope is the runtime path, so this is a docs/test note, not a behavior defect. Minor.

#### m-3 — `keepUnprovenLaunch` step 3 uses the passed runtime, not `runtimeForHandle`
- File: `packages/core/src/session-manager.ts:2569`: `const stopped = await stopRuntime(runtime, handle);`
- Design 5.2.3 step 3: `stopRuntime(runtimeForHandle(handle, rollback.runtime), handle)`.
- Evidence: for a just-created handle `rollback.runtime` is the registered plugin that just created it, so `runtimeForHandle(handle, rollback.runtime)` returns that same plugin — behaviorally equivalent. Mutant replacing `:2569` with `runtimeForHandle(handle, runtime) ?? runtime` builds clean and all T-4.2 rows still pass (run in `/tmp/aof2am/mutant1`: `fit2-create-rollback.test.ts -t "T-4.2"`, 26 passed). Align code with the design text or note the equivalence. Minor.

#### m-4 — Fit-2a order and retirement-label form (deviations 14, 16)
- Files: commits `36caf8a9..a999a78f` (6 commits: 1,2,3,4,4d, test-only `a999a78f`); `docs/DEVELOPMENT.md:645` (bold label, no `##` heading "Retire a Herdr record by hand").
- Design 8.1: "commits 1,2,3 and 4, then 4d" (no 6th commit). Implementer deviation 14 puts T-7.8a(3) for the start's stop site in a separate test-only commit `a999a78f` because amend/rebase are forbidden to the worker.
- Evidence: `git log --reverse 36caf8a9..a999a78f` shows `2399674a,6c2bd47e,b3fcae77,9324e7ac,d545063e,a999a78f`; `a999a78f` touches only `fit2-startup.test.ts` (no product). Landing owner can fold it into commit 4 on rebase; no product effect. The bold label carries the same recipe; no new heading level is fine for an interim note. Minor, accept both.

#### m-5 — Unrelated whitespace hunk in range
- File: `packages/cli/src/commands/send.ts:81-84` (`hasUnsubmittedCodexInput` whitespace-only reformat).
- Evidence: `git diff 36caf8a9..a999a78f -- packages/cli/src/commands/send.ts` includes it; no behavior, no test. Remove on touch or leave. Minor noise.

## 2. What was reviewed (task section 2)

### 2.1 F-3 (commit 2) — correct
- `SETTLED_STATES = idle,done` (`runtime-herdr/src/index.ts:85`), `BLOCKED_STATE="blocked"` (`:88`); `waitForSettledAgent` returns `BLOCKED_STATE` at first blocked poll (`:459`); `sendMessage` throws `RuntimeSendRefusedError(reason agent_blocked)` at all three points with correct `admitted`/`stage` (`:765` first settle `none`; `:773-778` `agent prompt attempt n` `none`/`earlier-attempt-unconfirmed`; `:785-788` settle-after `earlier-attempt-unconfirmed`); zero `send-text`/`send-keys` after refusal (`:795-797` unreachable after throw); `promptWasConsumed` from `idle` treats `blocked` as consumed (`:491`, delivery not refusal, per spec).
- Core `send` rethrows before restore retry (`session-manager.ts:4932`); CLI maps to one stderr line + exit 1, no stack (`send.ts:449-451`, `blockedSendLine :221-230`); tmux sends unchanged (no herdr branch in tmux path).

### 2.2 F-4 runtime-herdr `create` (commit 3) — correct
- Step 1 Q0: endpoint throw/`running!==true`/`compatible!==true` plain (`index.ts:516-525`, compatible message with version/protocol). `compatible` true only when JSON exactly `true`; `version`/`protocol` typed else null (`herdr.ts`, `STATUS_RUNNING` gains `"compatible":true`).
- Rule Q exact (`herdr.ts:145-160`): Q1 full message with `endpoint.socket`; Q2 `/^client protocol \d+ is (newer|older) than server protocol \d+; /`; `cliFailureOf` unwraps `cause` iff `herdrCode` string with `cliIdOf(args)` (`:225-228`); IDs `workspace create→cli:workspace:create`, `pane run→cli:request` (`:52-61`).
- Steps 2–6 per table: Q→plain with `herdrCode` (+no-server `code`); else partial `workspace-unconfirmed` (`id ""`) / `launch-not-submitted` (script removed `:648-651`) / `launch-unconfirmed` (script kept `:652`); step 3 missing ids → partial with what parsed; step 6 `pane get` P+T success else `launch-unconfirmed` (+`terminalAfterRun` when known `:679`); messages carry "AO closed nothing"; zero `workspace close`/`pane close` in `create` (`:502-693` only create/run/get; `destroy` refuses `:702-707`; `stop` unknown no call `:718-733`).

### 2.3 F-4 core (commit 3) — correct
- P (`session-manager.ts:680-681`) + reservation (`2778-2788`), claim `readLaunchClaim` (`2855-2856,3306-3310`), restore 7a P+claim (`5463-5471`); pre-create write merges so P+claim stay (`3109,3718`); `launchedRecordFor` keeps `LAUNCH_TOKEN_KEY/AT` + one `preCreateAt` value (`3053-3062,3673-3682`); `recordMayOwnRuntime` true for `createIncomplete` (`2274-2278`).
- `keepUnprovenLaunch` keeps everything on partial/post-create failure (record with partial handle + `launchFailed`, worktree, agent session, prompt file, script for `launch-unconfirmed`); plain errors keep today's destructive rollback; other runtimes unchanged; `keepUnconfirmedLaunch` settles after `launchFailed` write.

### 2.4 Claims and settlement — correct, including r11 m-2
- `settleOwnClaim(identity, ownClaim)` (`731-746`) via `clearOwnLaunchClaimOnce` (`697-716`, record lock, `extra` for relaunch): null `ownClaim` → nothing; else one strict read after null (`740`), one retry (`742`), second null/throw → settlement-could-not-be-written; identity+own-pair compare, never clears later claim/none/gone.
- Ordinary settlement null-retry is implemented (m-2 required change); new `m-2` test (resident restore, first clear null via `existsSync`, one strict read + one retry, no warning, no claim; control with later claim pair byte-equal/no retry) passes; D2 `m2` mutant (no read/retry) fails exactly that test.
- Relaunch `settleOnce` shares the helper with `extra`, retains later tries; relaunch behavior unchanged (15 relaunch files green per report D0; `launchToken/At` not identity keys so `after` independent).

### 2.5 `publishOwnLaunch` (4.5) — correct, including r11 m-1
- Fixed `before=launchIdentity(owned)`, `after=launchIdentity(mergedRecord(owned,updates))` once (`session-manager.ts:799-800`); `mergedRecord` skips `undefined` (deviation 5, matches `updateMetadataIf`); at most 2 `updateMetadataIf(before,updates)` with same object (`806`); strict `readRecordStrict` after every undecided attempt (throw and null, retry included `:813`); table: after→written (adopt only fixed after `:817`), before→retry then unwritable/pending, neither/no record→not-own, read throw→unwritable/unknown.
- Spawn/start handle writes are publications (`own.publish`, `:3166-3168,:3772-3774`); not-own→`recordChangedError`, unwritable→`LaunchRecordUnwritableError(before,after,lastRead,handle)`; post-create catch forwards without `partialRecord`; rollback step 0 handles it with no further write.
- Unwritable (`868-916`): no removal; final settlements `before` then `after` on null (two fixed-identity attempts, m-1 required change); three warning variants with session/error/file/worktree/agentSession/handle + four keys; fit-2a ending `RETIRE_BY_HAND` (deviation 2, F-9 is fit-2b). No interleaving found where another writer (restore/kill/lifecycle/second spawn) causes publish into a foreign record, clear of another claim, or silent loss: every settlement compares fixed identity + own pair; `before`/`after` never derive from a judged record; replacement differing only in `restoredAt` matches neither (T-4.20g).
- Mutant check (mine, `/tmp/aof2am/mutant1`): recomputing `after` from the read record fails T-4.20g (2 failed, `expected undefined toMatch /^Session app-1 changed while the spawn started its runtime/`); equivalent `runtimeForHandle` refactor passes (26 T-4.2 passed). Report D2's 33 mutants each fail their named tests (spot-checked `pub-after-from-read`, `pub-no-read-after-null`, `pub-one-final`, `m2`, `settle-any`).

### 2.6 Restore — correct
- Claim (`5311-5312`), 7a transition with `before`/`publishedClaim`/`owned` (`5481-5488`), `writeBackTransition` comparing exact claim state and clearing only own claim (`5496-5517`), step 9 partial publication + settlement on new identity / not-own appends kept-runtime sentence / unwritable path (`5529-5557`), step 10 success publication with fixed before/after (`5636-5675`), step 11 `postLaunchSetup`, step 12 `settleOwnClaim` + throw→warn (`5737-5744`), step-7 damaged-handle refusal via `isUnprovenLaunchRecord` (`5436-5444`, detail first 80 chars, `releaseCopyBack`, handle `{id:"",runtimeName:"herdr",data:{}}` deviation 15 — needs a handle for the error shape, correct). Second restore of kept failed/P refuses at step 7 (Herdr `unknown`).

### 2.7 Dispatch (commit 4) — correct
- `runtimeForHandle(handle,fallback)` (`2754-2764`): registered→it; in-set unregistered→`null`; else fallback. `notLoadedStop` (`2768-2770`, "no runtime plugin <name> is loaded").
- Sites: start probes (`3366-3368,3427-3429`), `stopOrchestratorOrRefuse` (`3318-3324`), restore step 7 (`5430-5434`), `killRecord` (`3985-3998`, `null` fallback; in-set unloaded→`RuntimeStopUnconfirmedError` kept, else today's skip), list enrichment (`2108-2120`, null→no probe, stored status stays), cleanup dead-runtime (`4336-4339`, null→no probe/kill). Unproven never "gone" (`isOrchestratorRuntimeAlive :1125-1155`: no plugin→unknown, `RUNTIME_NO_SERVER` only ends non-herdr, herdr false→unknown). Tmux records unchanged. Extra test-only commit `a999a78f` adds T-7.8a(3) for the start's stop site (deviation 14).

### 2.8 Commit 1 — correct, additive only
- `runtime-errors.ts` (238 lines): guards check `code`+shape, no `instanceof`, cross-copy safe (`isRuntimeCreatePartialError :85-95`, `isRuntimeSendRefusedError :134-145`, `isOrchestratorStartBlockedError :226-238`); rule Q near-miss set (T-4.1b); `launchIdentityToken` (16 hex SHA-256, `metadata.ts:354-357`); `admission` kind + `admissionLock(sessionsDir,projectId)` with D2-a subject rule (`delivery-lock.ts:47-56,75-112`; `projectId` param deviation 1 — required by `OrchestratorStartBlockedError` shape); `isUnprovenLaunchRecord` (`types.ts:475-484`); `Runtime.create` doc, `preflight?`, `index.ts` exports additive (`:38,42-63`). No product caller in fit-2a except tests (grep `admissionLock(` only def + `delivery-lock.test.ts`), as designed.

### 2.9 No regression — correct
- Tmux + other runtimes: spawn/restore/kill/send/relaunch/cleanup/lifecycle unchanged for non-herdr; `isProcessRunning` contract kept (claude rejects, codex/gemini/opencode false, not authoritative; P/empty-ID paths distinct).
- Fit-1 interim startup guard + tests unchanged (core `orchestrator-herdr-start.test.ts`, runtime-herdr `fit-startup-interim.test.ts`, CLI `start.test.ts`, `start-herdr-interim.test.ts`, note-2 F1 reader tests green).
- Changed oracles all justified by 5.2.7/5.3.10 (index close/error/pane texts + 4th `pane get` + `STATUS_RUNNING compatible:true`; `fit-pins` PANE 4th reply + keep-no-close; `fit-reads` session-form not-Q1 + new Q1 sibling + `pane_not_found` partial; `herdr.test.ts:662,691` endpoint fields).

### 2.10 Scope and size — as reported, justified
- Task states product +1711/-246, tests +3972/-48 (L); design estimated ~1030 + ~2300 (M upper). `git diff --stat 36caf8a9..a999a78f`: 27 files, 5695 insertions, 295 deletions. Product drivers: `session-manager.ts` 1135 (publication/settlement/restore/rollback/P/pre-create/dispatch in one file — the risk is commit 3, as design warned), `runtime-herdr/index.ts` 320 (6 steps + F-3 + pins), `runtime-errors.ts` 238 new, `types.ts` 58 + `herdr.ts` 64 + `delivery-lock.ts` 68 + `metadata.ts` 15 + `send.ts` 32 + docs 13. Test drivers: `fit2-create-rollback.test.ts` 1848 (end-to-end: built core + real plugin + stand-in herdr with own workspaces/admissions + real worktree plugin on temp git + both agent shapes; covers T-4.1–T-4.21 with letters, T-4.19/20/21 strict-read/retry/unwritable matrices), `index.test.ts` +693 (F-3 + oracle changes), `fit2-startup.test.ts` 479 (T-7.8/26d), `runtime-errors.test.ts` 234 + `send-refusal.test.ts` 97 + `delivery-lock.test.ts` 105 + `herdr.test.ts` 143 + `types.test.ts` 83 + `send.test.ts` 108.
- The ~65% overrun is the publication/settlement proof burden (two writes + two strict reads + three warning variants + replacement controls T-4.20g/21e) and the commit-1 API unit tests for names with no fit-2a product caller (admission lock, token, guards — needed for fit-2b stability). Needed for HIGH risk; no product file outside the 9 + docs.

### 2.11 Tests — strong; 19 pass on base for stated reasons
- New tests fail on `36caf8a9` for stated reasons and pass on tip (report D1: 162/181 fail on base; 96/181 fail on commit 1 at behavior oracles; appendix quotes each first failure; e.g. T-7.8a `expected [] to deeply equal [['pane','get','w3:p2']]`, T-3.7 `expected [Function] to throw ... but got 'herdr agent in pane w7:p1 is blocked …'`, import failures for new exports). T-3.1 OOM on base/commit 1 excluded with `-t` filter + diagnostic copy (`isRuntimeSendRefusedError is not a function` / `expected false to be true`) — accepted.
- 19 pass on base: 6 controls by design (T-3.5, T-3.7 control, T-4.8 Q2 both, T-7.8d mock, T-7.26d tmux); 6 consumer pins unchanged by fit-2a (T-4.11 kill, T-4.12 get/list, T-4.13 cleanup, 3× T-4.14 sends — write kept record directly, base gives same Herdr `unknown` answers; fit-2a-only F-9 hint/status are fit-2b); 7 base-lacks-mechanism (T-4.16/17 cc 3 cases no claim so none remains, T-4.18 no claim so later values stay, T-4.19a/b no transition so record stays). D2 shows each of the 7 fails when its fix is undone (`settle-none`, `identity-reserved`, `settle-any`, `wb-always-clear`, `wb-none`) — accepted as evidence; open questions 2–3 ask the same and need no fit-2a code change.
- Non-vacuity: report D2's 33 mutants each fail their named tests; I re-ran `pub-after-from-read` (fails T-4.20g) and an equivalent `runtimeForHandle` refactor (passes, behavior-preserving). No risky rule lacks a guarding test.

### 2.12 Docs (4d) — correct
- `docs/DEVELOPMENT.md:673-681` 7 interim notes (refused send; kept failed launch with check recipe; P/crashed launch; unwritable 3 variants + 4 keys + running-process claim; restore/dispatch + step-7 + write-back; startup until fit-2b with P-unprobeable/reuse-alive-gap/isolated-gap; retirement texts → by-hand). `CLAUDE.md:233` create sentence matches `types.ts:326`. All retirement texts end with by-hand recipe (deviation 2); step-7/transition/unwritable wordings match code.

### 2.13 Deviations (report §Deviations) — all accept
1. `admissionLock(sessionsDir,projectId)` extra `projectId` — required by error shape; no product caller; accept.
2. Unwritable "not settled" ends "... ao start and kill refuse it", no F-9 — F-9 is fit-2b (commit 7); all fit-2a texts use by-hand; accept.
3. Write-back warning claim phrase only with own claim — matches `publishedClaim` logic; accept.
4. Step-9 not-own appends kept-runtime sentence to thrown partial instead of separate warn — one text to caller, same content; accept.
5. `clearOwnLaunchClaimOnce` reads under lock only for `extra` — settlement write itself is the compare; strict read only after null per 4.5 order; accept.
6. `mergedRecord` skips `undefined` — matches `updateMetadataIf`; `after` equals written record; accept.
7. `fit2-create-rollback` dynamic `import()` of workspace dist — avoids cross-package dep + file-list change; test-only; accept.
8. T-4.20e(1) "one warning" is the thrown `recordChangedError` (restore throws for not-own) — no separate warn by design; accept.
9. T-4.18 checks later-claim byte-equality + `promptDelivered`, not whole record — `promptDelivered` write after settlement bumps generation; accept.
10. `writeRecord` direct text for keys `writeMetadata` drops — test harness necessity; accept.
11. T-4.14(b) fake timers for readiness — timing control; accept.
12. `herdr-fixtures.ts` copy of `herdrFormsLogEntry` — no cross-package test import; accept.
13. Fit-2b assertions absent (T-4.11 hint, T-4.12 status, T-4.16 start block, T-4.17 F-9 line, T-4.20c/d start blocks) — per 8.1 these come with commit 7/5; tests assert rest of rows; accept.
14. Sixth commit `a999a78f` test-only after 4d — D2 of dispatch needs T-7.8a(3); amend/rebase forbidden; owner folds on land; accept (see m-4).
15. Step-7 refusal handle `{id:"",runtimeName:"herdr",data:{}}` + 80-char detail — error shape needs a handle; accept.
16. No `## Retire...` heading, bold label at note-3 recipe start — same recipe, no new heading level; accept (see m-4).

### 2.14 Open questions (report §Open questions) — no fit-2a change needed
1. Commit order (test after docs) — owner rebase step, not worker; accept.
2. T-4.11–T-4.14 pass on base / fail under no mutant — 5.2.6 keeps consumer behavior; fit-2a-only assertions are fit-2b; arranging kept launch via failing create would make them fail on base but tests the same code via longer path; D2 + direct-record setup is accepted evidence for fit-2a.
3. T-4.16/17(cc)/18/19a/b pass on base — base lacks claim/transition; D2 is the accepted evidence (each fails under its mutant); no base-failing rewrite needed for fit-2a.
4. T-2.1 type assertion — oracle holds, T-4.1 step 3 asserts type; add in fit-2b if desired; no fit-2a change.

### 2.15 Landing readiness
- `git merge-tree --write-tree --merge-base 36caf8a9 main a999a78f` prints only `82cfdb8c3800a5ebd2e132fe0460891fae44a8b0`, exit 0 — no conflicting paths. (`main` has 8 docs commits since base; no product overlap.) Do not change any branch.
- No second agent for one session: claims (`assertNoLiveLauncher`, reservation/transition compares, `liveLaunchOwner`), publication fixed identities, and restore G-leaves-out-restored-ID prevent it; M-6/R3 explicitly remain open per design and are not fit-2a gates.

## 3. Gates on `a999a78f` (scratch copies, offline, tmux shim)

- `pnpm install --frozen-lockfile --offline --store-dir=.../store/v3`: tip + base both 379 reused, 0 downloaded. (With `HOME=/tmp/aof2am/home` the default store is empty; explicit `--store-dir` is required — environment note, not product.)
- `pnpm build`: tip exit 0 (14 workspace projects), base exit 0.
- `pnpm typecheck`: tip exit 0, base exit 0.
- `pnpm lint`: tip 5 warnings, 0 errors — `cli/src/commands/spawn.ts:333:24`, `core/src/activity-log.ts:91:31`, `core/src/plugin-registry.ts:232:7` (`no-non-null-assertion`), `core/src/session-manager.ts:3228:11`, `:3235:9` (`no-console`). Base same 5 with consoles at `:2728:11`, `:2735:9` (fit-2a lines above them). Matches the 5 known.
- `pnpm -r --no-bail test` (tmux shim first on PATH): tip core 65 files passed, 1847 passed + 1 expected fail (1848); runtime-herdr 9 files, 261 passed; cli 29 files, 447 passed; agent-claude-code 10 files 368, codex 7 files 318, gemini 3 files 99, opencode 6 files 365, runtime-tmux 6 files 116, workspace-worktree 5 files 85, scm-github 3 files 140 (+5 skipped), tracker-github 1 file 42, notifier-desktop 1 file 26 — all as on base except core +60 (runtime-errors 37, delivery-lock 6, herdr 5, types 5, metadata 4, send-refusal 3), runtime-herdr +115 (fit2-create-rollback 65, fit2-startup 18, index +31 net, fit-reads +1), cli +3 (T-3.7). Integration-tests 7 passed + 3 failed files (4 failed / 87 passed / 24 skipped) identically on tip and base — sandbox tmux pane-output empties (`expected '' to contain 'INTTEST_MARKER…'`, `hello world`, long text), no regression. (An early run with a minimal PATH missed `readlink`/`flock`/etc. and failed 4 GH_WRAPPER + 14 claude-hook tests; with the full shim PATH all pass — environment, not product.)
- `SAME_ID_DEFECTS=red` over same-id files: tip and base identical (only order differs), total 21 failing (core 1, claude 1, codex 1, gemini 1, opencode 2, runtime-tmux 11, workspace-worktree 4) — R2 15 + R3 6 per report D0/D3; nonzero exit as expected; no fit-2a test in the set.
- `gitleaks git --log-opts=36caf8a9..a999a78f --redact`: 6 commits scanned, no leaks found, exit 0.
- Per-commit gates per report D3 (build/typecheck/lint + changed-package tests green; 4d docs only): accepted on report evidence; tip full run above confirms the union.

## 4. What was found correct (short list)

- F-3 refusal at all three points with zero further sends; core rethrow before restore; CLI line + exit 1.
- F-4 Q0/Q1/Q2 exactness + near-miss partials; no close on any path; script kept/removed per table; post-run `pane get`.
- P + pre-create + reservation/transition writes; `keepUnprovenLaunch`/`keepUnconfirmedLaunch` keep everything on partial/post-create failure; plain-error rollback unchanged.
- Fixed `before`/`after`, strict read after throw and null + retry + second read, two final unwritable attempts, three warning variants, no foreign publish/clear/loss.
- Restore transition/write-back/step 9/10/12 + damaged-handle refusal; dispatch at every site with unknown-not-gone; tmux unchanged.
- Commit-1 guards/token/admission/predicate additive; docs 7 notes + CLAUDE.md sentence accurate.

## 5. Cleanup evidence

- `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2am-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'` printed only:
```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```
All are concurrent real-state writes by the running lifecycle workers / Nexus project / this project's own session record (ao-73 is this reviewer's session, written by its lifecycle worker) — none mine (this review ran no `ao` command; every `pnpm`/`node`/test ran under `HOME=/tmp/aof2am/home`). Protected sessions/workers/panes/worktrees (`3133311`, `3133656`, `140323`, `ao-73`, `ao-orchestrator`, owner's `0`/`3`, other reviewer's session/worktree) were not touched; no `pkill`/`killall`/pattern kill (only `ps` listing above).
- `~/.ao/bin` end listing exactly matches the start listing (same 4 files, sizes, modes, 2026-10-16 times).
- Own processes: none (`ps aux | grep aof2am/vitest` empty; every foreground command returned).
- Private servers gone: `env -u TMUX tmux -L aof2am-tests ls` → "no server running on /tmp/tmux-44402/aof2am-tests"; no `aof2am-*` server remains.
- `/tmp/aof2am` removed (`ls /tmp/aof2am` → "No such file or directory"); `/tmp/aof2am-marker` used for the scan then removed.
- `git status --short`: only `?? .agent_task.md` (orchestrator brief), `?? .agent_report.md` (required report), `?? development/reviews/herdr_fit2a_code_review_r1_muse13.md` (this review). `git diff --exit-code` clean (no tracked change). No commit, push, PR, or network action.
