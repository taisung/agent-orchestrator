LAND-SAFE

# Herdr fit-2a r2 landing check (Codex)

Target `a999a78f..1b407dbd`, owner decision 22. HEAD verified `1b407dbd`. Only this review and the explicitly required report-back file are written in the worktree; all probes/builds/tests use scratch archives. No commit, push, PR, network, AO command, live agent or Herdr server is authorized.

All three r1 majors and Muse m-1/m-3 are closed. No new findings (0 B, 0 M, 0 m). Required gates pass, the red set is unchanged, and merge-tree has no conflicts.

## Initial evidence

Marker `/tmp/aof2as2-marker` created. `~/.ao/bin` initial listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Three commits read before the implementer's report: `5dec5ca4`, `943c01e9`, `1b407dbd`. Diff is exactly four paths (+188/-7): core session-manager.ts, runtime-herdr index.ts, and runtime-herdr's fit2-create-rollback.test.ts/index.test.ts. The eight ownership tests are appended; the three blocked-without-name tests are inserted next to F-3 cases; no old test body or oracle changed.

Scratch environment: `env -i HOME=/tmp/aof2as2/home TMPDIR=/tmp/aof2as2/tmp PATH=/tmp/aof2as2/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`. PATH is a link-only directory with cached pnpm 9.15.4 and required basic utilities; no agent binary or herdr. gh only accepts --version/auth status. The tmux shim unsets TMUX and supplies `-L aof2as2-tests` (explicit test -S wins). Offline install uses cached store v3.

## Gate evidence collected

- Offline frozen install, root build and typecheck: exit 0.
- Lint: exit 0, exactly five known warnings: cli spawn.ts:333:24, core activity-log.ts:91:31, plugin-registry.ts:232:7, session-manager.ts:3232:11 and :3239:9. ESLint also prints its existing .eslintignore migration notice.
- Gitleaks `git --log-opts=36caf8a9..1b407dbd --redact`: exit 0, nine commits scanned, no leaks.
- Merge-tree with `main` at `ca76d3008038377e4a2a5ca2dd0f9b2f2b6e5a2f`: exit 0, tree `2fc188062dba822b4be7e9a8ec7af91092c97bca`. Conflicting paths: none. No ref written or branch changed.
- Full `pnpm -r --no-bail test`: exit 0 on the first run. Core 1847 passed/1 expected fail; runtime-herdr 272; CLI 447; Claude Code 368; Codex 318; Gemini 99; OpenCode 365; runtime-tmux 116; workspace-worktree 85; scm-github 140 passed/5 skipped; tracker-github 42; notifier-desktop 26; integration-tests 91 passed/24 skipped. Exactly the implementer's counts. Relative to a999a78f, only runtime-herdr increases (+8 ownership tests, +3 blocked-without-name tests). Private-tmux cases ran with no skips in runtime-tmux/agent packages.

## Source and assertion check

- **r1 M-1:** `fit2-create-rollback.test.ts:1874` reproduces resident restore step 11 replacing only restoredAt while retaining the returned handle and the process pair. It checks full file byte-equality at :1889, explicitly compares both claim values at :1891, and requires zero warnings at :1898. This is the requested distinct-identity/same-pair schedule.
- **r1 M-2:** `fit2-create-rollback.test.ts:1902` lists reservationId, runtimeHandle, tmuxName, createdAt, restoredAt. They are exactly all five keys of `LAUNCH_IDENTITY_KEYS` (`core/src/metadata.ts:331`); RESERVATION_KEY is reservationId. Each :1910 case replaces the pending record before its first publication attempt, independently changes that key, verifies the copied P/live claim, requires rejection, full byte-equality at :1926 (therefore both claim values unchanged), no worktree destroy or runtime close, and exactly one replacement warning. The original fixed-after T-4.20g cases remain intact.
- **r1 M-3:** `fit2-create-rollback.test.ts:1935` and :1961 cover both workspace failure (step 8) and qualified plain-create refusal (step 9). Both verify copied P and the resident claim, full replacement byte-equality (including the pair), and the exact single write-back warning. Step 8 makes no Herdr call; step 9 proves the error is plain and no workspace was created. These cover the requested identity compare independently of the earlier claim-only controls.
- **Muse m-1:** `runtime-herdr/src/index.ts:460` checks blocked before requiring an agent name. The settled-state condition at :461 remains unchanged and still needs a name. Both settle callers retain their typed refusal: first wait admits none, later wait reports earlier-attempt-unconfirmed. The three new `index.test.ts:1085/:1100` cases cover null/omitted name at the first wait and null name after one prompt, with no later prompt/raw text/key. The existing unknown/no-agent fallback test is unchanged.
- **Muse m-3:** `core/src/session-manager.ts:2570` now resolves the handle's runtime; null becomes the same notLoadedStop used by the other dispatch sites. For today's registered just-created Herdr handle, it selects the same plugin and still keeps the launch on its unknown answer. Only step 3 and its comment changed; ownership/publication/settlement code is unchanged.

After reading all three commits, I read the new r2 portion of the implementer's report and the now-authorized Muse m-1/m-3 text. The source/assertion assessment above is independent of that report. Muse m-2/m-4/m-5 are unchanged as owner decision 22 directs; this check does not reopen them.

## Independent mutation results and finding disposition

Each mutation was applied alone in an archive of 1b407dbd. Core was rebuilt for every core mutation (all builds exit 0); the complete original runtime-herdr suite ran with JSON reporting, excluding only reviewer-added probe copies. The unmodified suite passes **272/272**. Source hashes after restoration match 1b407dbd exactly (`session-manager.ts` acbcb7153abfe84d331f80cb0173c50385a5e8f7; runtime-herdr index.ts d29da1315104600cb6712e12b9fd6625eb9053c2).

| Mutation | Result out of 272 | Distinguishing tests |
| --- | --- | --- |
| Ordinary settle passes `{ identity: {} }` | 1 failure | r2 M-1 |
| Delete before.reservationId in publishOwnLaunch | 1 failure | r2 M-2 (reservationId) |
| Delete before.runtimeHandle | 2 failures | r2 M-2 (runtimeHandle), existing T-4.20d |
| Delete before.tmuxName | 1 failure | r2 M-2 (tmuxName) |
| Delete before.createdAt | 1 failure | r2 M-2 (createdAt) |
| Delete before.restoredAt | 1 failure | r2 M-2 (restoredAt) |
| Write-back compares publishedClaim without launchIdentity | 2 failures | r2 M-3 (step 8), r2 M-3 (step 9) |
| Restore the old blocked condition requiring pane.agent | 3 failures | null-name/omitted-name first wait, null-name wait after attempt 1 |
| Restore the old step-3 stopRuntime(runtime, handle) | 0 failures | All 272 existing scenarios give the same result |

The M-1 mutant clears the replacement's claim and changes its file; its byte-equality assertion fails. Each M-2 key mutant allows the spawn to continue, so the expected rejection's `.message` is undefined and the matching rejection assertion fails; every other key's new test still passes. The M-3 mutant changes the replacement back to the prior restoredAt and removes P/the claim; both full-file assertions fail. These match the original r1 defects in the tests, rather than unrelated setup/type errors. The blocked-condition undo reaches raw send-text/send-keys, so all three new no-raw-input assertions fail.

**r1 M-1: CLOSED. r1 M-2: CLOSED. r1 M-3: CLOSED.** All requested identity comparisons now have independently verified, non-vacuous tests, with full byte-equality, claim preservation and warning assertions described above. No ownership product-code change was needed to close these coverage findings.

**Muse m-1: CLOSED.** Both callers now refuse blocked irrespective of agent name. Besides the three new refusal tests, seven scratch-only controls pass: unknown with null, omitted or named agent; idle with null/omitted agent; done with null/omitted agent. Each asserts exactly one pane get followed by raw send-text and Enter, with no agent prompt. Thus unknown keeps its prior fallback, and idle/done still require an agent name to enter the settled-prompt path. The existing named-agent idle/done tests also pass in the full suite.

**Muse m-3: CLOSED.** The undo's 272/272 result verifies equivalence for current registered just-created handles. A separate scratch stand-in tests the null branch: the registry loses its Herdr entry after pane-run admission returns an uncertain failure, while rollback still has the earlier runtime object. The fixed code calls no stop on that fallback object, keeps the partial record/worktree, settles its claim and emits the one warning containing `no runtime plugin herdr is loaded`. The old step-3 implementation fails this probe because it invokes the stale object's stop once. This is a synthetic registry-loss schedule, not a claim that ordinary product callers unload plugins today; it verifies that notLoadedStop follows the other dispatch sites' rule.

New findings: **0 B, 0 M, 0 m**. Muse m-2/m-4/m-5 remain the previously accepted notes outside these directed fixes.

## Red set and landing readiness

`SAME_ID_DEFECTS=red pnpm exec vitest run same-id` across all nine packages containing same-ID tests gives exactly the prior **21 failures: R2 15, R3 6**. Per package: core 1; CLI 0; Claude Code/Codex/Gemini 1 each; OpenCode 2; runtime-herdr 0; runtime-tmux 11; workspace-worktree 4. Expected nonzero exits were retained. Full failing-name set:

```text
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, isAlive of the old launch answers false
[same-id R2] B-1: two launches of an ID in the same second destroy of the first launch keeps a replacement of the ID that started in the same second
[same-id R2] B-1: two launches of an ID in the same second isAlive of the first launch answers false while a same-second replacement of the ID runs
[same-id R2] B-2: a replacement between the create and its launch keys create: a replacement of the ID made directly after the create command never receives the first launch's keys
[same-id R2] B-5: another server answers at the recorded socket path isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
[same-id R2] B-5: another server answers at the recorded socket path isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
[same-id R2] D-B: a call finds the tmux server only through its environment destroy from another server's environment does not end that server's session of the same name
[same-id R2] D-B: a call finds the tmux server only through its environment isAlive answers true for a live session when the caller's environment names another server
[same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the codex pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the gemini pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the opencode pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] F-5: destroy by name ends another launch of the same name destroy keeps a newer session of the same name that another launch created
[same-id R2] F-7: a hidden socket of a running server reads as no server isAlive does not report 'no server' while the recorded server process still runs
[same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree create does not remove a worktree that another launch made at the path during the checkout
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files restore: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files spawn: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get a rollback during another spawn's session.get does not remove the session that the spawn then stores
[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime
[same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it kill and restore of one ID: the active record at the end still has its worktree
```

These are the same R2 B-1/B-2/B-5/D-B/F-5/F-7 and R3 F-1/F-2/F-3/F-5 cases recorded in r1; no new test is in the failing set. The diff contains no same-ID test change.

All requested gates pass. The merge-tree snapshot is conflict-free (main SHA and tree recorded above). The branch is ready for the orchestrator's authorized cherry-pick; this check makes no commit or branch change.

## Cleanup

After all test cells completed, a /proc environment scan found **[]** remaining processes with `HOME=/tmp/aof2as2/home` (excluding the scanner). No process was signalled by this reviewer. The explicit private-server check answered `no server running on /tmp/tmux-44402/aof2as2-tests`; no default-server command ran.

The required scan was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2as2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path:

```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2245
```

The first two paths belong to concurrent agent-skills lifecycle/session activity (worker 3133656 identified in the brief); the last three belong to concurrent Nexus lifecycle/session activity (worker 140323). No review command authored these real-state writes: all node/pnpm/test parents used scratch HOME with inherited AO variables removed, and no real-config AO call ran. Specific syscall-writer PIDs were not instrumented; this is project/path attribution, not measured process attribution. No protected session, worker, pane or worktree was acted on.

`~/.ao/bin` final listing is byte-equal to the initial listing (same entries, sizes, modes, mtimes; not a content-hash claim). Main remained `ca76d3008038377e4a2a5ca2dd0f9b2f2b6e5a2f`. `git diff --exit-code` passes. Status contains only the two review files, required report, and externally supplied task/note; the r1 review is untouched. Only the r2 review and required report were written in the worktree. No commit/push/PR/network action occurred.

The unused private socket, `/tmp/aof2as2` and `/tmp/aof2as2-marker` are removed at completion; removal is verified before this turn ends and recorded in the report-back file.
