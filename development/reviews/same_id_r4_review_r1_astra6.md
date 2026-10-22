# Same-ID R4 review r1

**NOT-LAND-SAFE — 0 blockers, 3 majors, 0 minors, 5 older follow-ups.** Review range: `75f1c98b..fa2f7ac8`, review/same-id-r4. Review only, no production edits, commit, rebase, pull, push or PR. Author report unread until independent source/caller/oracle review (items 1–3) is complete. Artifact: code and its test claims; res-audit workflow applied.

Marker `/tmp/aor4r1-marker` made before executable checks. Every node/pnpm/helper/test uses env -i, HOME=/tmp/aor4r1/home, TMPDIR=/tmp/aor4r1/tmp, PATH=/tmp/aor4r1/bin:/usr/bin:/bin, CI=1; no inherited AO variables or agent binary. gh stub allows only --version/auth status. Private tmux shim unsets TMUX and forces /dev/null config and aor4r1-test57. Real config/state and protected fleet are not used. No model or real Herdr/OpenCode process. Scratch source copies, stand-ins and any AO paths stay under /tmp/aor4r1; /tmp/aor4 is read-only.

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

## Initial independent source/oracle review (author report still unread)

The 11 locations are present. Allocation now uses the existing strict archive listing before reservation; active-holder enumeration and record/archive reads fail conservatively; recovery uses lstat and keeps workspace.exists rejection as probeError/skip; workspace.exists distinguishes missing path, exit-128 not-repository, and successful true; core/runtime Herdr and the three agents reject ordinary command failures; the OpenCode send probe no longer treats a connection failure as PaneGoneError. The active restore refusal now attributes its lack of changes correctly.

Boundary concerns under test: workspace.exists uses an unanchored `not a git repository` substring for any exit 128; agent tmux/ps success parsers still accept malformed output as no process; Herdr error-text fallback can override an unrelated error, and partial payloads are not fully validated. These are hypotheses until the runs below.

Amendment 1 inspection: core herdr.test.ts changes only the three old fail-open names/oracles (missing binary, invalid JSON, malformed entries). Claude's Herdr-unavailable test changes only name/oracle. Codex/Gemini old tmux failure and activity-exited expectations become rejection, and all three agents' Herdr-unavailable expectations become rejection; their setup stays the same. Removed timestamp assertions were part of the now-inapplicable resolved activity oracle. New tests are in allowed agent test files. Defect files flip R4 markings and remove unused defect helpers, with small formatting reflows; no other-round assertion is weakened. The active restore test changes only its requested refusal string. The 26-file diff is within allowed source/test/doc locations; no send.ts, detectActivity, screen fixture or unrelated source edit.

## Caller availability review (independent items 1–3 complete)

- Lifecycle: a throwing runtime/agent probe is failed, never a fresh dead confirmation. Agent negatives count only after runtime alive; two-negative confirmation remains. Stuck/needs_input are preserved on failure. The old no-server bound still marks killed after its bound; R4 does not change it. A busy host's temporary exec failure is retried on later polls, not cached forever.
- `ao status`: session enrichment catches runtime/agent probe errors and leaves activity unknown. Display remains read-only. The original exception is generally not displayed here; persistent unknown needs checking the runtime/tool outside this display.
- Kill and cleanup: R2a's confirmed-stop gate remains. Herdr stop still refuses intentionally with its manual close instruction. Cleanup runtime rejection names the runtime/session and manual check/retry; strict OpenCode holder uncertainty keeps the resource through the later strict removal guards. The coarse hasOtherOpenCodeRecord result may select another liveness check; it does not itself claim evidence that no other record exists.
- Restore: workspace.exists rejection exits before archive reservation, runtime stop or workspace recreation. Missing path or git's explicit not-repository still allows the existing restore path; a stop refusal retains the R2a protection. Active-record message is now correctly attributed. A vanished tmux server remains an existing R2a refusal until a server can answer, with the existing manual check/retry guidance.
- Recovery: runtime/agent probe failures already skip; R4 extends skip to lstat/workspace errors with `Liveness unknown (...); no action`. Explicit missing paths and false workspace results still classify as missing. A later successful probe can recover availability.
- Spawn/isolated orchestrator: unreadable archive listing stops before reservation and names the directory, reason and make-readable/retry instruction. ENOENT still allocates. Root-workspace orchestrator allocation behavior is unchanged.
- OpenCode removal: unreadable active/archive reads are held, and later removal guards retain their own strict checks. OpenCode pane connection failure during launch/delivery now rejects with the cause and no automatic restore. Actual missing session/window/pane still takes the existing gone path. Runtime-herdr delivery waits remain lenient polling and are outside stop/allocation decisions.

No author report was used for these checks. Scope/oracle and availability observations now permit reading its kept-on-purpose list. Source boundaries under active falsification are reported separately below.

## Confirmed boundary findings (reviewer runs)

**M-1 — item 7 still turns an unrelated Git failure into absence.** `packages/plugins/workspace-worktree/src/index.ts:295–299`. Category: retained fail-open behavior in R4's changed classifier. It accepts exit 128 whenever stderr contains `not a git repository` anywhere, including a quoted path. Real Git reproduction: initialize a valid repository at `/tmp/aor4r1/live/not a git repository`; with Git's `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` test override, rev-parse exits 128 with `fatal: detected dubious ownership in repository at '<path>'`. The built plugin returns false instead of rejecting. Without the override it returns true. Through the built session manager, this false lets a restore stop the runtime and enter workspace recreation (measured stop=1, restore=1, create=0; the reviewer workspace stand-in deliberately throws before modifying the repository). The repository remains valid. The ordinary dubious-ownership test uses a path without the substring, so it misses this case. Match the actual not-repository diagnostic, rather than arbitrary path/message text, and retain the original cause for all other failures. No production fix was made.

**M-2 — items 10/11 still accept malformed successful tmux/ps output as an agent negative.** `packages/plugins/agent-codex/src/index.ts:581–605`, `packages/plugins/agent-gemini/src/index.ts:212–236`, `packages/plugins/agent-opencode/src/index.ts:1324–1348`, and OpenCode's `findPaneOpenCodeProcess` parsing at `:681–699`. Category: left in code R4 changes. Nine independent rejection assertions fail: each of the three agents returns false for empty TTY output, invalid TTY text, or a malformed ps reply. Exit 0 alone does not make these a valid list proving absence. Valid live/dead ps controls pass for all three agents. The lifecycle and OpenCode-send effects are checked below. Reject malformed replies before allowing an agent negative or a no-TUI result; keep valid lists without the agent negative.

**M-3 — Herdr's new strict boundary still mistakes ambiguous or malformed evidence for a negative.** `packages/core/src/herdr.ts:70–74,122–134`; `packages/plugins/runtime-herdr/src/index.ts:134–139,217–228,459–467`. Category: retained in changed strict-read code. An exec error carrying an explicit `server_unavailable` envelope whose message mentions `pane not found` returns [] (core) or false (runtime), because substring matching overrides the failure. A malformed foreground entry `{pid:123,name:'node',argv:[12]}` is accepted by filtering out the invalid argument and retaining the non-agent name. A pane-get response for a different pane (`w99:p8` while querying `w7:p1`) with another terminal is interpreted as the requested pane's terminal mismatch and returns false. These are not evidence that the requested pane/agent is gone. Preserve command-failure type and structured error code; restrict legacy missing-pane text to an unambiguous diagnostic, and validate the fields/identity used by the negative decision. Additional built-code evidence follows. The existing terminal-mismatch control for the *same* pane remains valid.

Initial reviewer boundary suite: 3 valid live/dead controls pass, 14 strict-negative assertions fail. Failures resolve false/[]/a normalized malformed entry rather than reject. This is separate from the 22 supplied R4 tests, which all pass.

M-2 caller evidence: the reviewer lifecycle test passes for a real agent probe rejection (working stays working) and a valid dead control (becomes killed). The malformed-success case fails because two polls persist `status=killed` while the runtime answers alive. A separate OpenCode delivery test with malformed successful pane/ps replies produces `AgentNotAttachedError` after the wait, so core may request a restore; the strict-unknown assertion fails. No OpenCode prompt API runs. This confirms an effect beyond an inaccurate direct boolean.

M-3 built-code evidence: configuring the runtime's allowed binPath as `/tmp/aor4r1/live/herdr-probe/pane_not_found/missing-binary` returns false on actual spawn ENOENT, because the path in the exec error contains the substring. No Herdr binary exists there. A shell protocol stand-in returning server_unavailable with missing-pane text and exit 1 gives core=[]/runtime=false; the identical envelope at exit 0 correctly rejects in both. A malformed argv yields isHerdrProcessRunning=false; a response for another pane gives runtime false. Explicit pane_not_found, valid empty processes, and the same requested pane with a replaced terminal still return their intended negative controls. No real Herdr process ran.

## Author's kept-on-purpose list

Read after items 1–3, and compared to source. Agree with leaving reuse-candidate and archived-cleanup candidate enumeration lenient in this bounded R4: those lists choose candidates, while actual removal has separate strict guards. `findLiveOpenCodeSessionHolder` still has a lenient active listing, but every removal path also uses the existing strict holder/ownership checks; leaving that older helper is not a new R4 regression on removal paths. Its unchanged remap use at session-manager.ts:4213 has no equivalent strict holder check; that older allocating-path gap belongs in F-5 below. Runtime-herdr's delivery `getPane` polls again and decides no stop/removal; retaining its lenient read is consistent with scope. These choices do not excuse M-1–M-3 in the changed decision reads.

The author correctly notes that item 3's EACCES scenario was already kept by the old outer catch, with a misleading runtime-check reason; this test validates attribution, not a new safety improvement. The archive EACCES allocation test also pins the new contextual message; the base already threw on readdir EACCES. ELOOP supplies the fail-open allocation demonstration. No oracle weakening was found.

## Location/control ledger

Line numbers were checked against the base and tip source; caller retention is described above.

| Item | Base location | Tip location/change | Gone control and result |
| --- | --- | --- | --- |
| 1 | core/session-manager.ts:1231,1286 | 1264,1319 via listArchivedSessionIdsForAllocation:688 | ENOENT archive still allocates app-1; strict ELOOP/EACCES no reservation/create tests pass |
| 2 | same:996 listMetadata in hasOtherOpenCodeRecord | 1024 listRecordIds; catch true | readable listing without another holder allows cleanup; ELOOP entry retained |
| 3 | same:999 readMetadataRaw | 1026 readRecordStrict; catch true | readable other-session record is not a holder; late EACCES kept with holder reason |
| 4 | same:1001–1002 archive lookup | 1028–1032 strict archive list, null means held | no matching archive allows cleanup; unreadable latest archive retained |
| 5 | core/recovery/validator.ts:81 existsSync | 86 lstat; other errors set probeError | ENOENT path stays missing; parent EACCES/ELOOP give skip |
| 6 | same:87–90 workspace.exists catch false | 94–98 catch sets probeError | exists false stays missing; rejection gives skip |
| 7 | workspace-worktree/index.ts:264–275 | 274–309 strict exists | missing path/no-git and canonical exit-128 not-repository are false; true output true; M-1 remains |
| 8 | core/herdr.ts:43–96 lenient process read | 62–137 strict read | pane_not_found and valid empty list negative; ordinary failure tests pass; M-3 boundaries remain |
| 9 | runtime-herdr/index.ts:195–201 getPane;424 isAlive | 217 getPaneStrict;459 isAlive | missing pane/same pane with replaced terminal negative; ordinary failures reject; M-3 remains |
| 10 | agent-codex/index.ts:543; gemini:174; opencode:1280 | codex:543; gemini:174; opencode:1286 | explicit missing pane/no current target and valid ps without agent negative; ordinary failures reject; M-2 remains |
| 11 | agent-opencode/index.ts:647–680 | 652–710 findPaneOpenCodeProcess | explicit missing pane still gone; connection/no-server/timeout reject with no restore; malformed success remains M-2 |
| R2a m-1 | core/session-manager.ts:4443 | 4476 active refusal text | three refusal-mode message assertions pass, fail on old text; correct attribution |

## Required mutants

Each mutation was made only in the archived scratch tip, then restored in finally. Both core subpath and public package imports resolve that copy through source aliases. Normal changed-test runs cover the control files with zero failures. Commands: local node_modules/vitest/vitest.mjs run --config review.config.ts <files> --reporter=json --outputFile=<result>.

| Mutant | Pass | Fail |
| --- | ---: | ---: |
| core-allocation | 16 | 4 |
| recovery-path | 17 | 3 |
| runtime-herdr | 5 | 4 |
| codex-ps | 169 | 2 |

Core allocation reinstates the lenient archive listing in both allocators; recovery-path makes a non-ENOENT path failure act missing; runtime-herdr routes isAlive back through the lenient getPane; codex-ps returns false on the ps rejection. Failing tests:

core-allocation:
- `[same-id R4] D-D: older reads that answer 'nothing' when they cannot check spawn does not take a session number while the archive directory cannot be checked`: AssertionError: the spawn took app-1 without a check of the archive: expected { generation: '3', …(10) } to be null
- `same-id R4, B-7 item 1: no session number while the archive directory cannot be listed spawn refuses with the reason, before any reservation, workspace or runtime`: AssertionError: expected { id: 'app-1', …(12) } to be an instance of Error
- `same-id R4, B-7 item 1: no session number while the archive directory cannot be listed spawn refuses for an archive directory that cannot be read (EACCES)`: AssertionError: expected 'EACCES: permission denied, scandir \'…' to contain 'Cannot choose a session number'
- `same-id R4, B-7 item 1: no session number while the archive directory cannot be listed an isolated orchestrator start refuses with the reason, before any reservation, workspace or runtime`: AssertionError: expected { id: 'app-orchestrator-1', …(12) } to be an instance of Error

recovery-path:
- `[same-id R4] D-D: older reads that answer 'nothing' when they cannot check recovery: a workspace that cannot be checked does not give a live session the cleanup action`: AssertionError: expected 'cleanup' not to be 'cleanup' // Object.is equality
- `same-id R4, B-7 item 5: the recovery validator keeps a path that cannot be checked as unknown a path under a symlink loop (ELOOP) gives a live session no action`: AssertionError: expected 'cleanup' to be 'skip' // Object.is equality
- `same-id R4, B-7 item 5: the recovery validator keeps a path that cannot be checked as unknown a path under a parent that cannot be read (EACCES) gives a live session no action`: AssertionError: expected 'cleanup' to be 'skip' // Object.is equality

runtime-herdr:
- `[same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' isAlive rejects when herdr answers an error envelope that is not 'pane not found'`: Error: promise resolved "false" instead of rejecting
- `[same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' isAlive rejects when herdr answers a reply without a pane`: Error: promise resolved "false" instead of rejecting
- `[same-id R4] D-D: runtime-herdr isAlive answers false when it cannot check isAlive rejects when the herdr command times out`: Error: promise resolved "false" instead of rejecting
- `[same-id R4] D-D: runtime-herdr isAlive answers false when it cannot check isAlive rejects when the herdr binary cannot start`: Error: promise resolved "false" instead of rejecting

codex-ps:
- `isProcessRunning rejects with the ps failure as cause when ps cannot run`: Error: promise resolved "false" instead of rejecting
- `[same-id R4] D-D: the codex liveness answers false when it cannot check isProcessRunning rejects when ps fails`: Error: promise resolved "false" instead of rejecting

## Gates and merged compatibility

All worktree commands used the isolated environment recorded above. Frozen install and build completed before built-code probes. The ten requested filters ran together; one full recursive test run followed. No real agent/Herdr/OpenCode binary is on the gate PATH.

```text
pnpm install --frozen-lockfile: exit 0 (HUSKY=0)
pnpm build: exit 0
pnpm typecheck: exit 0
pnpm lint: exit 0, 5 problems (0 errors, 5 warnings)

filtered (exit 0):
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1569 passed | 1 expected fail (1570)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  79 passed (79)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  71 passed (71)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  224 passed (224)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  330 passed (330)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)

full (exit 0):
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1569 passed | 1 expected fail (1570)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  71 passed (71)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  224 passed (224)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  79 passed (79)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  330 passed (330)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)

merge-build (exit 0):
packages/core build: Done
packages/plugins/agent-gemini build: Done
packages/plugins/agent-claude-code build: Done
packages/plugins/agent-opencode build: Done
packages/plugins/agent-codex build: Done
packages/plugins/notifier-desktop build: Done
packages/plugins/runtime-herdr build: Done
packages/plugins/scm-github build: Done
packages/plugins/runtime-tmux build: Done
packages/plugins/tracker-github build: Done
packages/plugins/workspace-worktree build: Done
packages/cli build: Done

merge-test (exit 0):
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  284 passed (284)
packages/cli test:  Test Files  22 passed (22)
packages/cli test:       Tests  305 passed (305)
```

The five lint warnings are unchanged non-null assertions in spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232 and console statements in session-manager.ts:2368,2375. Integration: 91 pass/24 skip; live agent-dependent blocks skipped. Core now has 1569 passing tests (1570 total); all formerly expected core R4 failures are plain passing tests, with the older R3 expected failure remaining.

Merged tree: captured main `7c1516696af4f4310771e06f24616b26ce97ab85` contains landed Codex send fix `e3be12a9`; merge base is `75f1c98b`. `/usr/bin/git merge-tree --write-tree <main> fa2f7ac8` produced clean tree `05e569f2ce4f4eab61c9b0a5b612f67cdda6591b`. Archived it under /tmp/aor4r1/merged, built all packages there, then ran pnpm --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-cli test. Its workspace dependency links point to the merged packages (including CLI -> merged agent-codex), not the unmerged worktree. No branch, index or tracked source was changed.

SAME_ID_DEFECTS=red ran all same-id-defects and same-id-reuse-window files across core, CLI, four agents, two runtimes and worktree, with scratch source aliases.

| Round | Base fail/pass | Tip fail/pass |
| --- | --- | --- |
| R1 | 0/17 | 0/17 |
| R2 | 16/20 | 16/20 |
| R3 | 6/0 | 6/0 |
| R4 | 22/11 | 0/33 |

All 22 original R4 defect cases fail on 75f1c98b and pass on fa2f7ac8. Other-round statuses are unchanged. With the tip test files on base source, 61 failures are observed across the changed test files; on tip the same files all pass. This includes flipped defects, changed oracles and new negative tests; positive controls need not fail on the base. Full title/first-assertion evidence is retained below. EACCES allocation and item-3 late record-read tests measure improved diagnosis as noted above.

The identical 17 boundary probes on base source give 3 passing controls and 14 failures, the same as the tip. M-1–M-3 are retained failures in the exact decision code R4 changes; this review does not label them newly introduced failures. The normal gates remain green because they do not cover these boundaries.

## Verdict, commits and follow-ups

**NOT-LAND-SAFE for 75f1c98b..fa2f7ac8.** M-1, M-2 and M-3 block landing under the explicit “left it in code R4 changed” rule. There is no blocker-category finding and no minor finding. They concern the changed strict-negative decisions themselves, not a demand to fold R2b or R3 into R4. No new source change was made by this reviewer.

Five nonblocking older follow-ups:

1. **F-1:** runtime launch/server identity and the default-socket/no-server-bound limitations remain R2b work. A server exit can still reach the old lifecycle bound; R4's new agent rejection does not close that existing rule.
2. **F-2:** operation/workspace and OpenCode ownership serialization remain R3 work (the six R3 red cases are unchanged).
3. **F-3:** cleanup still chooses the project's runtime rather than the stored handle's runtime. A Herdr handle in a tmux project can be kept indefinitely with an invalid-tmux-name reason. Source at session-manager.ts:3395–3400 is unchanged; the author also reports this. Fix routing separately.
4. **F-4:** older missing/malformed runtime identity or unloaded-plugin skip guards in kill/recovery remain as in R2a. R4's specified probe-error branches do not alter those guards.
5. **F-5:** findLiveOpenCodeSessionHolder's old lenient listing is backed by strict name/ownership checks on removal routes, but its unchanged remap call at session-manager.ts:4213 can omit an unreadable other holder before changing a mapping. This allocating-path gap is outside the 11 changed reads; source follow-up, not an independently executed remap race in this review.

Correct parts: strict archive allocation precedes reservation and resource creation; missing archive controls remain usable; ordinary active/archive holder read failures retain resources; path/plugin failures in recovery now skip with a reason; normal git failures and malformed git successes reject; normal Herdr/tmux/ps exec errors reject; explicit gone controls work; the active restore refusal now attributes its own lack of changes correctly. The supplied tests are meaningful, the four required mutants fail, and the clean combination with the landed Codex send fix passes.

Commits: seven single-parent commits, exactly 75f1c98b -> 09516df8 -> c973e045 -> 55c3f546 -> 13a4e99e -> 40c3310c -> c968a7da -> fa2f7ac8. Conventional fix/docs subjects and substantive WHY bodies; no Co-Authored-By trailers, emoji or issue references. The last two commits are docs only. /usr/bin/git branch -r --contains fa2f7ac8 prints nothing. No fetch/pull, rebase, commit, push or PR. Scope is 26 files, +1179 -273; all source edits fall in the allowed functions/files, plus their tests and the two allowed docs.

## Retained execution evidence and reproducers

Scratch source copies came from git archive (base, tip and base with tip tests); public core and its subpath imports use per-copy source aliases. Merged builds use their own workspace dependency links. All commands use the clean environment documented at the top. Original tests were not edited in the review worktree. Reproducers below can be written to the named scratch test paths and run with local Vitest and the same source aliases.

### Base with tip tests: failed titles and assertions

```text

core 106 passed 23 failed
getHerdrPaneProcesses rejects when herdr is not installed
  Error: promise resolved "[]" instead of rejecting
getHerdrPaneProcesses rejects on unparseable output
  Error: promise resolved "[]" instead of rejecting
getHerdrPaneProcesses rejects a reply with malformed entries
  Error: promise resolved "[ { pid: 4242, name: 'claude', …(1) } ]" instead of rejecting
restore that recreates a workspace or copies an archive back (review r1, M-1) an active record, its worktree missing, other-launch: refuses; no active record, no worktree and no runtime appear
  AssertionError: expected 'runtime stop unconfirmed (other-launc…' to contain 'nothing was restored: this restore di…'
restore that recreates a workspace or copies an archive back (review r1, M-1) an active record, its worktree missing, unknown: refuses; no active record, no worktree and no runtime appear
  AssertionError: expected 'runtime stop unconfirmed (unknown): t…' to contain 'nothing was restored: this restore di…'
restore that recreates a workspace or copies an archive back (review r1, M-1) an active record, its worktree missing, fallback: still runs: refuses; no active record, no worktree and no runtime appear
  AssertionError: expected 'runtime stop unconfirmed (unknown): t…' to contain 'nothing was restored: this restore di…'
[same-id R4] B-7 item 1: hasOtherOpenCodeRecord reads the content of the latest archive cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
[same-id R4] B-7 item 2: the recovery validator keeps a workspace check that rejects as unknown a workspace.exists that rejects (git could not start) gives a live session no action
  AssertionError: expected 'cleanup' to be 'skip' // Object.is equality
[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when the herdr binary cannot start
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when the herdr command times out
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers text that is not JSON
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers an error envelope that is not 'pane not found'
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers a result without process_info
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: older reads that answer 'nothing' when they cannot check spawn does not take a session number while the archive directory cannot be checked
  AssertionError: the spawn took app-1 without a check of the archive: expected { generation: '3', …(10) } to be null
[same-id R4] D-D: older reads that answer 'nothing' when they cannot check cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
[same-id R4] D-D: older reads that answer 'nothing' when they cannot check recovery: a workspace that cannot be checked does not give a live session the cleanup action
  AssertionError: expected 'cleanup' not to be 'cleanup' // Object.is equality
same-id R4, B-7 item 1: no session number while the archive directory cannot be listed spawn refuses with the reason, before any reservation, workspace or runtime
  AssertionError: expected { id: 'app-1', …(12) } to be an instance of Error
same-id R4, B-7 item 1: no session number while the archive directory cannot be listed spawn refuses for an archive directory that cannot be read (EACCES)
  AssertionError: expected 'EACCES: permission denied, scandir \'…' to contain 'Cannot choose a session number'
same-id R4, B-7 item 1: no session number while the archive directory cannot be listed an isolated orchestrator start refuses with the reason, before any reservation, workspace or runtime
  AssertionError: expected { id: 'app-orchestrator-1', …(12) } to be an instance of Error
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name item 2: an active entry that cannot be checked (ELOOP) keeps the session, with the holder reason
  AssertionError: expected [] to include 'app-1'
same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name item 3: an active record that becomes unreadable (EACCES) after the cleanup listed it keeps the session, with the holder reason
  AssertionError: expected [] to include 'app-1'
same-id R4, B-7 item 5: the recovery validator keeps a path that cannot be checked as unknown a path under a symlink loop (ELOOP) gives a live session no action
  AssertionError: expected 'cleanup' to be 'skip' // Object.is equality
same-id R4, B-7 item 5: the recovery validator keeps a path that cannot be checked as unknown a path under a parent that cannot be read (EACCES) gives a live session no action
  AssertionError: expected 'cleanup' to be 'skip' // Object.is equality

plugins/agent-claude-code 111 passed 1 failed
isProcessRunning — herdr runtime rejects when herdr is unavailable
  Error: promise resolved "false" instead of rejecting

plugins/agent-codex 164 passed 7 failed
isProcessRunning rejects on tmux command failure
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when no tmux server runs at the socket
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects with the ps failure as cause when ps cannot run
  Error: promise resolved "false" instead of rejecting
getActivityState rejects when the process check cannot run
  Error: promise resolved "{ state: 'exited', …(1) }" instead of rejecting
isProcessRunning — herdr runtime rejects when herdr is unavailable
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: the codex liveness answers false when it cannot check isProcessRunning rejects when ps fails
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: the codex liveness answers false when it cannot check isProcessRunning rejects when the tmux server cannot answer
  Error: promise resolved "false" instead of rejecting

plugins/agent-gemini 64 passed 7 failed
isProcessRunning rejects on tmux command failure
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when no tmux server runs at the socket
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects with the ps failure as cause when ps cannot run
  Error: promise resolved "false" instead of rejecting
getActivityState rejects when the process check cannot run
  Error: promise resolved "{ state: 'exited', …(1) }" instead of rejecting
isProcessRunning — herdr runtime rejects when herdr is unavailable
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: the gemini liveness answers false when it cannot check isProcessRunning rejects when ps fails
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: the gemini liveness answers false when it cannot check isProcessRunning rejects when the tmux server cannot answer
  Error: promise resolved "false" instead of rejecting

plugins/agent-opencode 227 passed 10 failed
isProcessRunning rejects on tmux command failure
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when no tmux server runs at the socket
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects with the ps failure as cause when ps cannot run
  Error: promise resolved "false" instead of rejecting
isProcessRunning — herdr runtime rejects when herdr is unavailable
  Error: promise resolved "false" instead of rejecting
confirmLaunch (I-3) does not read the pane as gone when no tmux server runs at the socket (same-ID R4, B-7 item 11)
  AssertionError: expected 'the pane of sess-1 is gone; OpenCode …' not to contain 'is gone'
deliverMessage (I-5) does not read the pane as gone when no server runs at the socket: no AgentNotAttachedError, no send
  AssertionError: expected AgentNotAttachedError: Cannot deliver to … { …(2) } to not be an instance of AgentNotAttachedError
deliverMessage (I-5) does not read the pane as gone when the connection to the server fails: no AgentNotAttachedError, no send
  AssertionError: expected AgentNotAttachedError: Cannot deliver to … { …(2) } to not be an instance of AgentNotAttachedError
deliverMessage (I-5) does not read a tmux timeout as 'no TUI': no AgentNotAttachedError after the wait, no send
  AssertionError: expected AgentNotAttachedError: Cannot deliver to … { …(2) } to not be an instance of AgentNotAttachedError
[same-id R4] D-D: the opencode liveness answers false when it cannot check isProcessRunning rejects when ps fails
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: the opencode liveness answers false when it cannot check isProcessRunning rejects when the tmux server cannot answer
  Error: promise resolved "false" instead of rejecting

plugins/runtime-herdr 5 passed 4 failed
[same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' isAlive rejects when herdr answers an error envelope that is not 'pane not found'
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' isAlive rejects when herdr answers a reply without a pane
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: runtime-herdr isAlive answers false when it cannot check isAlive rejects when the herdr command times out
  Error: promise resolved "false" instead of rejecting
[same-id R4] D-D: runtime-herdr isAlive answers false when it cannot check isAlive rejects when the herdr binary cannot start
  Error: promise resolved "false" instead of rejecting

plugins/workspace-worktree 5 passed 9 failed
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects a git success whose output is not 'true' (malformed success)
  Error: promise resolved "true" instead of rejecting
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects a git success with empty output
  Error: promise resolved "true" instead of rejecting
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects git's exit 128 for an I/O error
  Error: promise resolved "false" instead of rejecting
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects git's exit 128 for a repository that git refuses (dubious ownership)
  Error: promise resolved "false" instead of rejecting
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects git's 'not a git repository' text with another exit code
  Error: promise resolved "false" instead of rejecting
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects a path under a parent that cannot be read (EACCES), and runs no git
  AssertionError: expected false to be an instance of Error
same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing rejects a path under a symlink loop (ELOOP), and runs no git
  AssertionError: expected false to be an instance of Error
[same-id R4] B-7 item 2: workspace exists tells a missing path from a check that could not run exists rejects when the git binary cannot start (spawn ENOENT) for an existing directory
  Error: promise resolved "false" instead of rejecting
[same-id R4] B-7 item 2: workspace exists tells a missing path from a check that could not run exists rejects when git times out for an existing directory
  Error: promise resolved "false" instead of rejecting
```

### Reviewer strict boundaries (core/src/__tests__/review-strict-boundaries.test.ts)

```ts
import {it,expect,vi,afterEach} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const exec=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();const fn=Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec});return {...actual,execFile:fn};});
import {getHerdrPaneProcesses} from '../herdr.js';
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {create as gemini} from '../../../plugins/agent-gemini/src/index.js';
import {create as opencode} from '../../../plugins/agent-opencode/src/index.js';
import {create as herdr} from '../../../plugins/runtime-herdr/src/index.js';
import {create as worktree} from '../../../plugins/workspace-worktree/src/index.js';
afterEach(()=>vi.resetAllMocks());
const h={id:'review-1',runtimeName:'tmux',data:{}};
for(const [name,create] of [['codex',codex],['gemini',gemini],['opencode',opencode]] as const){
 for(const mode of ['empty-tty','invalid-tty','invalid-ps'] as const)it(`${name} rejects ${mode} success output`,async()=>{
 exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?(mode==='empty-tty'?'':mode==='invalid-tty'?'unavailable\n':'/dev/pts/73\n'):'procfs temporarily unavailable\n',stderr:''}));
 await expect(create().isProcessRunning(h)).rejects.toThrow();
 });
 it(`${name} ordinary live/dead controls`,async()=>{exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?'/dev/pts/73\n':` PID TT COMMAND\n123 pts/73 /usr/bin/${name}\n`,stderr:''}));expect(await create().isProcessRunning(h)).toBe(true);exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?'/dev/pts/73\n':' PID TT COMMAND\n123 pts/73 /bin/bash\n',stderr:''}));expect(await create().isProcessRunning(h)).toBe(false);});
}
it('git error text mentioning not a git repository in a path is unknown',async()=>{const dir=mkdtempSync(join(tmpdir(),'review-git-'));try{exec.mockRejectedValue(Object.assign(new Error('git failed'),{code:128,stderr:`fatal: detected dubious ownership in repository at '${dir}/not a git repository'\n`}));await expect(worktree().exists!(dir)).rejects.toThrow();}finally{rmSync(dir,{recursive:true});}});
for(const target of ['core','runtime'] as const)it(`${target} Herdr other error with missing-pane text remains unknown`,async()=>{exec.mockRejectedValue(Object.assign(new Error('Command failed: herdr pane get w7:p1'),{code:1,stderr:'{"error":{"code":"server_unavailable","message":"cannot determine whether pane not found"}}\n'}));const query=target==='core'?getHerdrPaneProcesses('w7:p1'):herdr().isAlive({id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}});await expect(query).rejects.toThrow();});
it('core Herdr malformed argv is not proof that the agent exited',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{process_info:{foreground_processes:[{pid:123,name:'node',argv:[12]}]}}}),stderr:''});await expect(getHerdrPaneProcesses('w7:p1')).rejects.toThrow();});
it('runtime Herdr mismatching response pane is unknown',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{pane:{pane_id:'w99:p8',terminal_id:'other'}}}),stderr:''});await expect(herdr().isAlive({id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}})).rejects.toThrow();});
```

### Reviewer lifecycle caller probe

```ts
import {it,expect,vi} from 'vitest';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
const exec=vi.hoisted(()=>vi.fn());vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();return {...actual,execFile:Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec})};});
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {createSessionManager} from '../session-manager.js';import {createLifecycleManager} from '../lifecycle-manager.js';import {readObservabilitySummary} from '../observability.js';import {readMetadataRaw,writeMetadata} from '../metadata.js';
import {createMockPlugins,createMockRegistry,createTestEnvironment} from './test-utils.js';
for(const mode of ['exec-error','malformed-success','valid-dead'] as const)it(`lifecycle ${mode}`,async()=>{
 const env=createTestEnvironment();const plugins=createMockPlugins(),agent=codex();const readActivity=agent.getActivityState.bind(agent);agent.getActivityState=async(s,t)=>s.id==='app-2'?{state:'active'}:readActivity(s,t);agent.recordActivity=undefined;
 const runtime={...plugins.runtime,name:'tmux',isAlive:vi.fn(async()=>true),getOutput:vi.fn(async()=>''),getMetrics:undefined};const registry=createMockRegistry({runtime,agent}),sm=createSessionManager({config:env.config,registry}),lm=createLifecycleManager({config:env.config,registry,sessionManager:sm,projectId:'my-app'});
 try{for(const id of ['app-1','app-2']){const wt=join(env.tmpDir,id);mkdirSync(wt);writeMetadata(env.sessionsDir,id,{project:'my-app',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:wt,createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id,runtimeName:'tmux',data:{}})});}
 exec.mockImplementation(async(cmd:string)=>{if(cmd==='tmux')return {stdout:'/dev/pts/73\n',stderr:''};if(cmd==='ps'){if(mode==='exec-error')throw Object.assign(Error('ps unavailable'),{code:1});return {stdout:mode==='malformed-success'?'procfs temporarily unavailable\n':' PID TT COMMAND\n123 pts/73 /bin/bash\n',stderr:''};}throw Error('unexpected '+cmd);});
 const listed=await sm.list('my-app');console.log('LIST',mode,listed.map(s=>({id:s.id,status:s.status,activity:s.activity})));
 const health=()=>readObservabilitySummary(env.config).projects['my-app']?.health['lifecycle.worker'];for(let i=0;i<2;i++){const before=health()?.correlationId;lm.start(3600000);lm.stop();await vi.waitFor(()=>expect(health()?.correlationId).not.toBe(before),{timeout:3000,interval:5});}
 const after=readMetadataRaw(env.sessionsDir,'app-1');console.log('AFTER',mode,after);expect(after?.status).toBe(mode==='valid-dead'?'killed':'working');
 }finally{lm.stop();vi.restoreAllMocks();env.cleanup();}
});
```

### Reviewer OpenCode send probe insertion script

```js
import {readFileSync,writeFileSync} from 'node:fs';const p='/tmp/aor4r1/tip/packages/plugins/agent-opencode/src/index.test.ts',s=readFileSync(p,'utf8');const marker='  // Same-ID R4 (B-7 item 11): only the server\'s answer that the pane does not';if(!s.includes(marker))throw Error('marker');const extra=`  it("review: malformed successful pane query is unknown and asks for no restore", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => Promise.resolve({stdout: cmd === "tmux" ? "not a tty\\n" : "not a process list\\n", stderr: ""}));
    const outcome = await withFakeTimers(() => agent.deliverMessage!(session(), TEXT));
    const err = (outcome as {error: Error}).error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AgentNotAttachedError);
    expect(mockPromptOpenCodeSession).not.toHaveBeenCalled();
  });

`;writeFileSync(p,s.replace(marker,extra+marker));
```

### Built real-Git reproduction

```js
import {execFileSync} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r1/live',path=dir+'/not a git repository';
const core=await import(root+'/packages/core/dist/index.js'),paths=await import(root+'/packages/core/dist/paths.js'),ws=(await import(root+'/packages/plugins/workspace-worktree/dist/index.js')).create();
assert.equal(process.env.HOME,'/tmp/aor4r1/home');const git=(...args)=>execFileSync('/usr/bin/git',['-C',path,...args],{encoding:'utf8'}).trim();
delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;assert.equal(git('rev-parse','--is-inside-work-tree'),'true');console.log('VALID REPOSITORY',path,await ws.exists(path));
process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER='1';try{git('rev-parse','--is-inside-work-tree');}catch(e){console.log('GIT FAILURE',JSON.stringify({status:e.status,stderr:String(e.stderr)}));}
console.log('PLUGIN EXISTS UNDER DUBIOUS OWNERSHIP',await ws.exists(path));
process.env.AO_STATE_ROOT=dir+'/git-state';const configPath=dir+'/git-config.yaml';writeFileSync(configPath,JSON.stringify({defaults:{runtime:'review',agent:'review',workspace:'worktree',notifiers:[]},projects:{review:{path:dir,repo:'review/scratch',sessionPrefix:'rv'}}}));process.env.AO_CONFIG_PATH=configPath;
const config=core.loadConfig(),sessions=paths.getSessionsDir(configPath,dir);mkdirSync(sessions,{recursive:true});let stopped=0,restored=0,created=0;const runtime={name:'review',isAlive:async()=>true,stop:async()=>{stopped++;return {outcome:'absent',evidence:'controlled review outcome'};},create:async()=>{created++;return {id:'new',runtimeName:'review',data:{}};},destroy:async()=>{},getOutput:async()=>'',sendMessage:async()=>{}};const agent={name:'review',processName:'no-model',getLaunchCommand:()=>'/bin/true',getEnvironment:()=>({}),getActivityState:async()=>({state:'active'}),getSessionInfo:async()=>null,isProcessRunning:async()=>true,detectActivity:()=> 'active'};
const workspace={...ws,restore:async()=>{restored++;throw Error('review blocked actual recreation');}};
const registry={get:(slot)=>slot==='runtime'?runtime:slot==='agent'?agent:slot==='workspace'?workspace:null,list:()=>[],register:()=>{},loadBuiltins:async()=>{}};
core.writeMetadata(sessions,'rv-1',{project:'review',status:'killed',branch:'main',worktree:path,runtimeHandle:JSON.stringify({id:'old',runtimeName:'review',data:{}})});
const before=core.readMetadataRaw(sessions,'rv-1'),sm=core.createSessionManager({config,registry});const err=await sm.restore('rv-1').catch(e=>e);console.log('RESTORE',JSON.stringify({message:err.message,stopped,restored,created,before,after:core.readMetadataRaw(sessions,'rv-1')}));assert.equal(stopped,1);assert.equal(restored,1);assert.equal(created,0);
delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;console.log('REPOSITORY STILL VALID',git('rev-parse','--is-inside-work-tree'));
```

### Built real-Git result

```text
VALID REPOSITORY /tmp/aor4r1/live/not a git repository true
fatal: detected dubious ownership in repository at '/tmp/aor4r1/live/not a git repository'
To add an exception for this directory, call:

	git config --global --add safe.directory '/tmp/aor4r1/live/not a git repository'
GIT FAILURE {"status":128,"stderr":"fatal: detected dubious ownership in repository at '/tmp/aor4r1/live/not a git repository'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory '/tmp/aor4r1/live/not a git repository'\n"}
PLUGIN EXISTS UNDER DUBIOUS OWNERSHIP false
RESTORE {"message":"Workspace missing at /tmp/aor4r1/live/not a git repository: restore failed: review blocked actual recreation","stopped":1,"restored":1,"created":0,"before":{"worktree":"/tmp/aor4r1/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"1"},"after":{"worktree":"/tmp/aor4r1/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"1"}}
REPOSITORY STILL VALID true
```

### Built Herdr stand-in reproduction

```js
import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r1/live/herdr-probe';mkdirSync(dir+'/bin',{recursive:true});
const {isHerdrProcessRunning,getHerdrPaneProcesses}=await import(root+'/packages/core/dist/herdr.js'),{create}=await import(root+'/packages/plugins/runtime-herdr/dist/index.js');
const handle={id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}};
console.log('SPAWN ENOENT WITH PHRASE IN BIN PATH',await create({binPath:dir+'/pane_not_found/missing-binary'}).isAlive(handle));
const binary=dir+'/bin/herdr';process.env.PATH=dir+'/bin:'+process.env.PATH;
function shim(stdout,stderr='',exit=0){writeFileSync(dir+'/stdout',stdout);writeFileSync(dir+'/stderr',stderr);writeFileSync(binary,'#!/bin/sh\n/bin/cat '+dir+'/stdout\n/bin/cat '+dir+'/stderr >&2\nexit '+exit+'\n',{mode:0o755});}
const unavailable=JSON.stringify({error:{code:'server_unavailable',message:'cannot determine whether pane not found'}});
shim('',unavailable,1);console.log('EXEC ERROR OTHER CODE',JSON.stringify({core:await getHerdrPaneProcesses('w7:p1'),runtime:await create().isAlive(handle)}));
shim(unavailable);for(const [name,fn] of [['core',()=>getHerdrPaneProcesses('w7:p1')],['runtime',()=>create().isAlive(handle)]]){const result=await fn().then(value=>({value}),error=>({error:error.message}));console.log('SAME ENVELOPE EXIT ZERO',name,JSON.stringify(result));assert(result.error);}
shim(JSON.stringify({result:{process_info:{foreground_processes:[{pid:123,name:'node',argv:[12]}]}}}));console.log('MALFORMED ARGV IS AGENT ABSENT',await isHerdrProcessRunning('w7:p1',/(?:^|\/)codex(?:\s|$)/));
shim(JSON.stringify({result:{pane:{pane_id:'w99:p8',terminal_id:'other'}}}));console.log('WRONG RESPONSE PANE IS GONE',await create().isAlive(handle));
shim(JSON.stringify({error:{code:'pane_not_found',message:'Pane not found'}}));console.log('EXPLICIT GONE CONTROLS',JSON.stringify({core:await getHerdrPaneProcesses('w7:p1'),runtime:await create().isAlive(handle)}));
shim(JSON.stringify({result:{process_info:{foreground_processes:[]}}}));console.log('VALID EMPTY LIST CONTROL',await getHerdrPaneProcesses('w7:p1'));
shim(JSON.stringify({result:{pane:{pane_id:'w7:p1',terminal_id:'term_b'}}}));console.log('SAME PANE REPLACED TERMINAL CONTROL',await create().isAlive(handle));
```

### Built Herdr result

```text
SPAWN ENOENT WITH PHRASE IN BIN PATH false
EXEC ERROR OTHER CODE {"core":[],"runtime":false}
SAME ENVELOPE EXIT ZERO core {"error":"herdr pane process-info --pane w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
SAME ENVELOPE EXIT ZERO runtime {"error":"herdr pane get w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
MALFORMED ARGV IS AGENT ABSENT false
WRONG RESPONSE PANE IS GONE false
EXPLICIT GONE CONTROLS {"core":[],"runtime":false}
VALID EMPTY LIST CONTROL []
SAME PANE REPLACED TERMINAL CONTROL false
```

### Built CLI status and lifecycle reproduction

```js
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r1/live/status';mkdirSync(dir+'/bin',{recursive:true});mkdirSync(dir+'/repo',{recursive:true});
const clean={...process.env};assert.equal(clean.HOME,'/tmp/aor4r1/home');
writeFileSync(dir+'/bin/tmux',`#!/bin/sh
case "$1" in
 has-session) exit 0;;
 list-panes) printf '/dev/pts/73\\n'; exit 0;;
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
for(const mode of ['error','malformed','dead']){
 writeFileSync(dir+'/mode',mode);for(const id of ['rv-1','rv-2'])core.writeMetadata(sessions,id,{project:'review',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:dir+'/repo',createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id,runtimeName:'tmux',data:{}})});
 const before=core.readMetadataRaw(sessions,'rv-1');const cli=execFileSync(process.execPath,[root+'/packages/cli/dist/index.js','status','--json','-p','review'],{env:process.env,encoding:'utf8'});console.log('CLI STATUS',mode,cli.trim());assert.deepEqual(core.readMetadataRaw(sessions,'rv-1'),before);
 const lm=core.createLifecycleManager({config,registry,sessionManager:sm,projectId:'review'}),health=()=>core.readObservabilitySummary(config).projects.review?.health['lifecycle.worker'];try{for(let i=0;i<2;i++){const previous=health()?.correlationId;lm.start(3600000);lm.stop();const end=Date.now()+3000;while(health()?.correlationId===previous&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.notEqual(health()?.correlationId,previous);}}finally{lm.stop();}
 const after=core.readMetadataRaw(sessions,'rv-1');console.log('LIFECYCLE',mode,JSON.stringify({before,after,health:health()}));assert.equal(after.status,mode==='error'?'working':'killed');
}
console.log('LIVE STATUS COMPLETE');
```

### Built CLI/lifecycle results

All three CLI status invocations exited 0 and left the raw record unchanged. In error mode activity is null (unknown); malformed and valid-dead modes show exited. The second record is an in-process positive control for lifecycle confirmation only; the CLI uses the real Codex plugin for both. The tmux/ps executables are shell stand-ins, not real agent processes or an unisolated server.

```text
CLI STATUS error [
    "activity": null,
    "activity": null,
LIFECYCLE error {"before":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1"},"after":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T02:49:43.475Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-1b71fb38-730a-4f02-8700-9eb644fa47b9","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
CLI STATUS malformed [
    "activity": "exited",
    "activity": "exited",
LIFECYCLE malformed {"before":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"2"},"after":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"killed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"3","killedReason":"agent-exited"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T02:49:43.780Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-7baf3d17-1240-467e-9c52-18163c1f404e","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
CLI STATUS dead [
    "activity": "exited",
    "activity": "exited",
LIFECYCLE dead {"before":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"4"},"after":{"worktree":"/tmp/aor4r1/live/status/repo","branch":"main","status":"killed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"5","killedReason":"agent-exited"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T02:49:44.145Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-efd818dd-e2ce-47d6-a97b-d9a4f5e31d79","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
LIVE STATUS COMPLETE
```

caller: 2 pass, 1 fail.

- `lifecycle malformed-success`: AssertionError: expected 'killed' to be 'working' // Object.is equality

send-boundary: 0 pass, 1 fail.

- `deliverMessage (I-5) review: malformed successful pane query is unknown and asks for no restore`: AssertionError: expected AgentNotAttachedError: Cannot deliver to … { …(2) } to not be an instance of AgentNotAttachedError

## Cleanup evidence

All 16 recorded private tmux server/pane PIDs from the integration gates exited. All foreground build/test/CLI/protocol-stand-in commands completed and their children exited. Lifecycle probes were in-process, with each timer stopped in finally; no lifecycle worker was started. /proc audit by scratch HOME/AO_STATE_ROOT, excluding the audit process and ancestors, plus the explicit PID ledger:

```json
{
  "recordedPids": [
    1347849,
    1347854,
    1347858,
    1347864,
    1347898,
    1347935,
    1349347,
    1349358,
    1418805,
    1418818,
    1418822,
    1418826,
    1418852,
    1418889,
    1421775,
    1421777
  ],
  "ownLiveProcesses": [],
  "recordedPidsStillPresent": []
}
```

`env -u TMUX /usr/bin/tmux -f /dev/null -L aor4r1-test57 list-sessions` under the clean environment reports `no server running on /tmp/tmux-44402/aor4r1-test57`. No real Herdr/OpenCode/model process or default tmux server was used. Protected workers 1294181 and 1294364, orchestrator pane, other sessions and watchers were not touched. No pkill, killall or patterned kill.

After `ls -la --time-style=full-iso ~/.ao/bin` (identical to before; diff prints nothing):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state check, every entry:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor4r1-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58
```

Read-only stat/grep/ls evidence:

```text
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
  Size: 4096      	Blocks: 8          IO Block: 4096   directory
Device: 259,5	Inode: 72486286    Links: 4
Access: (0755/drwxr-xr-x)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:53:32.439950397 -0400
Modify: 2026-10-21 22:53:03.471789802 -0400
Change: 2026-10-21 22:53:03.471789802 -0400
 Birth: 2026-10-14 12:14:17.283172845 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
  Size: 676       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72511718    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:49:02.400763847 -0400
Modify: 2026-10-21 22:48:33.171607739 -0400
Change: 2026-10-21 22:48:33.171607739 -0400
 Birth: 2026-10-21 22:48:33.171607739 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59
  Size: 709       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72511189    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:41:46.543288039 -0400
Modify: 2026-10-21 22:41:33.059672801 -0400
Change: 2026-10-21 22:41:33.059672801 -0400
 Birth: 2026-10-21 22:41:33.059672801 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
  Size: 685       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72508285    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:53:32.439950397 -0400
Modify: 2026-10-21 22:53:03.471789802 -0400
Change: 2026-10-21 22:53:03.471789802 -0400
 Birth: 2026-10-21 22:53:03.471789802 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
  Size: 681       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72508311    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:39:58.018378461 -0400
Modify: 2026-10-21 22:39:33.279080736 -0400
Change: 2026-10-21 22:39:33.279080736 -0400
 Birth: 2026-10-21 22:39:33.279080736 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
  Size: 4096      	Blocks: 8          IO Block: 4096   directory
Device: 259,5	Inode: 72490570    Links: 2
Access: (0755/drwxr-xr-x)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:41:03.755508269 -0400
Modify: 2026-10-21 22:40:47.743964313 -0400
Change: 2026-10-21 22:40:47.743964313 -0400
 Birth: 2026-10-21 11:40:19.908018346 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58
  Size: 690       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72511187    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 22:41:32.351692998 -0400
Modify: 2026-10-21 22:41:03.586513084 -0400
Change: 2026-10-21 22:41:03.586513084 -0400
 Birth: 2026-10-21 22:41:03.586513084 -0400
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:generation=25
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:branch=feat/same-id-r2a-read-agent-task-md-in-your-worktree-and-execute
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:status=stuck
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:project=agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:agent=claude-code
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55:createdAt=2026-10-21T18:11:33.442Z
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:generation=5
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:branch=feat/live-send-check-claude-do-no-work-wait-for-messages-from-the
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:status=working
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:project=agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:agent=claude-code
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59:createdAt=2026-10-22T02:41:04.919Z
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:generation=26
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:branch=feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:status=working
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:project=agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:agent=claude-code
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52:createdAt=2026-10-21T16:37:54.484Z
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:generation=27
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:branch=feat/codex-send-idle-read-agent-task-md-in-your-worktree-and-exec
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:status=stuck
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:project=agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:agent=claude-code
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54:createdAt=2026-10-21T18:03:19.256Z
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:generation=4
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:branch=feat/live-send-check-do-no-work-wait-for-messages-from-the-orches
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:status=working
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:project=agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:agent=codex
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58:createdAt=2026-10-22T02:40:46.456Z
total 32
drwxr-xr-x 2 taisung users 4096 2026-10-21 22:40:47.743964313 -0400 .
drwxr-xr-x 4 taisung users 4096 2026-10-21 22:53:03.471789802 -0400 ..
-rw-r--r-- 1 taisung users    2 2026-10-21 11:40:19.909018317 -0400 ao-46
-rw-r--r-- 1 taisung users    2 2026-10-21 12:02:48.503234366 -0400 ao-48
-rw-r--r-- 1 taisung users    2 2026-10-21 12:26:01.275814283 -0400 ao-49
-rw-r--r-- 1 taisung users    2 2026-10-21 13:48:21.043830944 -0400 ao-50
-rw-r--r-- 1 taisung users    2 2026-10-21 13:48:21.587815174 -0400 ao-53
-rw-r--r-- 1 taisung users    2 2026-10-21 22:40:47.743964313 -0400 ao-59
```

Attribution: ao-55 and ao-54 have external stuck-status updates; ao-52 has an external working-status update. ao-58 and ao-59 are external Codex/Claude live-send-check sessions created at 02:40:46Z and 02:41:04Z. The .generations directory changed with its ao-59 floor entry at 22:40:47 EDT; the sessions directory reflects external record renames. These paths belong to real fleet hash 60756641ca25. The reviewer used only /tmp/aor4r1 scratch state and fake HOME, never that state root or those session IDs. Metadata/timestamps support this attribution but do not identify the exact writer PID. No real fleet change is attributed to the reviewer. Tracked diff is empty; branch review/same-id-r4 remains at fa2f7ac8.

Final cleanup: `/tmp/aor4r1`, `/tmp/aor4r1-marker` and the exact owned private socket removed after the final empty-process audit; absence verified. Removal checked ownership and did not follow symlinks. Prior tracked reviews and production source remain unchanged.
