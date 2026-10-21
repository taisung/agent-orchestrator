# Killed-status review, round 8

LAND-SAFE — 0 blockers, 0 majors, 1 nonblocking minor.

Reviewed `69d6f467..ce49c9fd` at `ce49c9fdef32b5672a7ed8b84e01f6a2809364d6`. The whole fix, `0e3eabc2..ce49c9fd`, is land-safe under the owner's rule. No landing-blocking item remains. Round-7 M-1 is **fixed**. Unchanged code inherits the round-7 assessment; this is not a claim that all older cleanup paths are safe.

## Finding and audit rating

**m-1 — The generation floor can go backward on a read error; the never-repeat guarantee is too strong.** `packages/core/src/metadata.ts:506-516`, `:519-525`, `:531-536`; `docs/DEVELOPMENT.md:446`. Category: **left in code written by the whole fix**, introduced by `ef6c73d9`, with an absolute guarantee still present in the changed documentation. This is not an older-code exemption.

Reproducer: create generations 1 and 2 for an ID, delete without archiving so its floor is 2, make only the floor file mode 000 while its directory remains writable, then reserve the same ID. The new record gets generation 1. Delete that reservation while the floor remains unreadable: the persisted floor becomes 1. My built-core run reproduced both effects; the file's mode was restored 644 → 000 → 644. The catch-all returns 0 for an unreadable floor, and the atomic replacement can then lower it. Qualify the documented guarantee, or harden the floor read in a subsequent change.

**Why nonblocking:** the author's item 3(a) claim is correct for the current production comparisons, with a narrower scope than “no removal follows.” Each generation comparison also checks launch identity: `lifecycle-manager.ts:272`, `recovery/actions.ts:25,219`, and `session-manager.ts:735,3882,3901`. Identity includes reservation, runtime and launch timestamps (`metadata.ts:332-338`); normal new reservations have a fresh UUID, and restore changes the identity. In the actual stale-recovery probe, equal generation 1 did not bypass the guard: identity differed, cleanup returned RECORD_CHANGED, and runtime destruction count stayed zero. No current manager removal bypass was demonstrated. A caller must not treat generation alone as a never-repeating identity. This is a real contract/documentation defect, not another required archive safety fix.

**Item 3(b): older failure, F-8.** The workspace lookup at `recovery/validator.ts:78-92` is unchanged `9fa0a65e` code. The whole fix adds conservative treatment of rejected runtime/agent probes; it does not worsen the existing case where both probes succeed and workspace existence is false. My built validator/action probe reproduced cleanup of a live runtime with `escalatePartial: false` and an inaccessible workspace parent. The default escalates. The record was archived and the inaccessible workspace survived. This belongs in the separate follow-up list under the owner's rule.

**Item 3(c): the audit is sufficient for the changed removal decisions, subject to m-1.** `hasOtherOpenCodeRecord` (`session-manager.ts:971-985`, older `6a984d6c`) and allocation (`:1209-1216`, `:1265-1268`, older `c1e8c1e8`/`7e53542f`) retain their old behavior: F-9 and F-10. The older `findLiveOpenCodeSessionHolder` at `:954-969` is preceded by the strict namer check in the changed removal paths. Issue-reuse lookups at `:914-948` and archived-cleanup candidate enumeration at `:3258` can omit candidates after a failed lookup; this reduces the selected work, rather than granting a new removal. The reuse publication window remains F-3.

The author's remaining entries are consistent with that distinction: own-record/restore/claim lookups fail or decline destruction when no record can be read; pending-ledger/archive marking is conditional; recovery's missed-workspace cleanup can leave an orphan but still checks the assessed record version (included in F-8). Older false-on-error liveness is F-11, and tmux prefix/socket behavior is F-4/F-7. The fallback lock name at `metadata.ts:233-241` **is whole-fix code** (`e6e23c3`), not older code: failure of realpath can choose an unresolved lock name, but the same inaccessible path normally prevents the following record operation. The report's explanation is plausible for this failure mode; it is not proof against every possible alias schedule. No additional removal bypass was established in this short re-check.

## What is correct

- `listArchivedSessionIdsStrict` (`session-manager.ts:648-661`) treats only ENOENT as empty. The prepared holder decision at `:1686-1690` keeps and names the agent session on directory errors. Independent real-permission and symlink-loop cases now retain it; the genuinely missing-directory control removes it.
- A throw while reading a listed archive (`:1701-1713`) becomes a named holder and preserves the original launch failure. `openCodeNamers` (`:1583`) and ledger `namerOf` (`:3051`) read listed records strictly; failed reads keep the agent session/ledger. The kill archive step (`:2995-3017`) reports an unreadable record as a failure instead of reporting success.
- Status listing, kill and purge kill accept ordinary archives, lock files, `.generations`, a reservation and another agent's record. No normal entry in that control caused a throw.

## Deferred follow-ups

F-1–F-7 retain their round-7 reproductions and owner-approved deferral. References below are at the new HEAD; plugin paths are under `packages/plugins`, core paths under `packages/core/src`.

| ID | File:line and reproduction | Rating |
| --- | --- | --- |
| F-1 | `workspace-worktree/src/index.ts:146`: replace the workspace during a failing checkout; create's cleanup can remove the replacement. | Older create cleanup; unchanged and explicitly deferred. |
| F-2 | `workspace-worktree/src/index.ts:372`; `session-manager.ts:1945,4233`: publish a replacement during create/restore, then run the old destructive postCreate. | Older postCreate behavior; unchanged and explicitly deferred. |
| F-3 | `session-manager.ts:1154,2054`: delay reuse's session.get, remove the session while reuse intent is unpublished, then publish the returned mapping. | Existing selection/read/write window; requires a claim or serialization. |
| F-4 | `runtime-tmux/src/index.ts:170,225`: leave only a longer name sharing the requested prefix. | Accepted bare-target prefix behavior. |
| F-5 | `session-manager.ts:1759,4321`; `workspace-worktree/src/index.ts:190,201`: replace the resource after the last ownership check and before the command. | Accepted final command interval. |
| F-6 | `session-manager.ts:1765,4311`: retain a runtime whose replacement record is only a reservation. | Warning names it, but normal status may not expose a usable session; visibility deferred. |
| F-7 | `lifecycle-manager.ts:1574`: hide a live pane's socket beyond 300,000 ms. | Repeated no-server answers can eventually mark killed; explicitly deferred. |
| F-8 | `recovery/validator.ts:81,87`; `recovery/actions.ts:166,183`: make a live session's workspace parent unsearchable and set `escalatePartial: false`. | Older lookup selects cleanup; own run destroyed the mock runtime once, archived the record and left the workspace. Default recovery escalates. Not made or worsened here. |
| F-9 | `session-manager.ts:971-985,3224`: hide an archive naming a dead session's OpenCode ID, then run purging cleanup. | Older helper may report no other holder; the kill's strict active-record check does not inspect archives. Source/provenance checked; not independently replayed this round. |
| F-10 | `session-manager.ts:1209-1216,1265-1268`: make archive enumeration uncheckable during allocation. | Older allocator can reuse an archived number; the owner explicitly retained the old listing for these callers. |
| F-11 | `agent-opencode/src/index.ts:1279`, `agent-codex/src/index.ts:542`, `agent-gemini/src/index.ts:173`, `runtime-herdr/src/index.ts:397`: make an existing liveness query fail. | Older plugins can answer false and feed recovery/convergence; documented limitation retained from r7, no new sweep or regression established. |

None of F-1–F-11 changes this verdict. m-1 is counted above, not hidden among older follow-ups.

## Tests, mutations and scope

The new tests add 6 core holder tests, 3 built OpenCode holder tests and 5 strict-read tests. Existing assertions were retained; permission helpers now restore each original mode. Tests ran as ordinary uid 44402, so chmod 000 actually denied reads. The synchronous-boundary tests substitute filesystem results deterministically; a separate process could also change permissions between synchronous calls, so “synchronous” should not be taken as making the underlying race impossible.

Own scratch copy: `git archive ce49c9fd`, linked dependencies, no build outside this worktree. Local Vitest ran the core holder and strict-read files. Baseline: `Test Files 2 passed; Tests 26 passed`. With my r7 regression (only diagnostic wording updated from records to archives): `Tests 27 passed`. Each independent mutant was reverted before the next one; both modified scratch files were restored byte-for-byte.

| Mutant | Tests that fail | Summary |
| --- | --- | --- |
| Holder uses old archive listing | Existing archive behind an unsearchable directory; same before hook; archive symlink loop | 3 failed, 23 passed |
| Archive-read throw means no holder | Read fails after listing before hook; same during hook wait | 2 failed, 24 passed |
| `openCodeNamers` uses `readMetadataRaw` | Purge: existsSync hides a listed record naming the OpenCode session | 1 failed, 25 passed |
| Ledger `namerOf` uses `readMetadataRaw` | Ledger retry: existsSync hides a listed record naming the key | 1 failed, 25 passed |
| Kill reports success on unknown archive result | Sessions directory cannot be checked during archive; record stays | 1 failed, 25 passed |

Requested gates, in this worktree under fake HOME, scratch PATH and no AO_* variables, all exited 0. Package scripts resolve the local Vitest binary. Frozen install and build completed before built probes. Integration had no real agent binary on PATH; tmux used private servers.

| Command/package | Quoted summary |
| --- | --- |
| `pnpm install --frozen-lockfile` | `Lockfile is up to date, resolution step is skipped`; `Done in 2.4s` |
| `pnpm build` | `Scope: 14 of 15 workspace projects`; all build scripts `Done` |
| test filter: core | `Test Files 51 passed`; `Tests 1364 passed` |
| test filter: CLI | `Test Files 20 passed`; `Tests 261 passed` |
| test filter: runtime-tmux | `Test Files 1 passed`; `Tests 40 passed` |
| test filter: agent-claude-code | `Test Files 3 passed`; `Tests 212 passed` |
| test filter: workspace-worktree | `Test Files 2 passed`; `Tests 61 passed` |
| test filter: agent-opencode | `Test Files 4 passed`; `Tests 316 passed` |
| integration | `Test Files 10 passed \| 3 skipped`; `Tests 91 passed \| 24 skipped` |
| `pnpm lint` | `5 problems (0 errors, 5 warnings)` — existing warnings |
| `pnpm typecheck` | `Scope: 14 of 15 workspace projects`; all typecheck scripts `Done` |
| `pnpm -r --no-bail test` | Sum of package summaries: 101 files passed, 3 skipped; 2866 tests passed, 29 skipped; no failures |

No B-1/dead-poll live case was repeated, as instructed. The diff contains exactly the five allowed files: core session manager, development docs, two core tests and the OpenCode test. No production plugin, CLI, metadata, types or recovery change; the old `listArchivedSessionIds` function is byte-identical to `69d6f467`. Three linear commits, each conventional and explaining WHY: `ce3c6fb4` → `de70dfb8` → `ce49c9fd`. No Co-Authored-By, emoji or issue number. `git branch -r --contains ce49c9fd` prints nothing. No tracked worktree changes; prior r2–r7 review hashes unchanged.

## Evidence written during the review

This is the requested short re-check. Unchanged paths retain the round-7 assessment; F-1 through F-7 remain deferred. Landing findings must be made, worsened, or left in code changed by the whole fix (`0e3eabc2..ce49c9fd`). No source edits, commit, push, PR, network gh, real AO command, OpenCode executable or model turn.

Scratch root `/tmp/ao47-kr8`, marker `/tmp/ao47-kr8-marker`. Helpers/tests use env -i, fake HOME and scratch PATH. tmux calls use a private-server shim that clears AO_* and TMUX. API/version functions are stand-ins. Prior reviews remain untouched. The author report was unread until independent items 1–2 were complete.

## Independent items1–2

Frozen install/build exited0 before the built probes. At2026-10-21T14:01:21.568Z, kr-2's archive named ses_prepared behind a symlinked archive directory whose parent became mode000 during kr-1's interrupt. stat reported EACCES, existsSync false; the new decision retained/named ses_prepared with zero removal calls. Parent755→000→755; archive remained readable afterward with its mapping intact. At.580Z, sessions/archive self-loop reported ELOOP and also retained/named the session with zero removals. At.592Z, the ENOENT control made one removal and released kr-1. Original launch failure remained the error in all cases.

A filesystem boundary stand-in made the archive read throw after successful listing: zero removals and a named unreadable-archive warning (.606Z). A listed active record hidden from existsSync stopped purge with zero agent removals (.620Z). The same condition in ledger namerOf kept the ledger and pending archive key (.624Z); readable-other-key control requested one removal and cleared pending (.628Z). These are built-core calls, actual files and actual OpenCode prepared discard, with API/version/ledger and specified filesystem boundaries substituted; no OpenCode executable ran.

Actual parent chmod000 after workspace cleanup made the kill's archive step fail visibly instead of reporting success (.630Z). After restoring755, the record remained and no archive existed. Ordinary archives, lock files, .generations, a reservation and another agent's record did not break status, kill or purge kill (.610–.618Z).

The independent scratch regression from r7 was re-run alongside the new tests; its diagnostic expectation now says archives rather than records. It passes at the new HEAD. Independent items1–2 complete; reading the author report next.

## Audit notes recorded during work

Author report read only after the independent pass. Its round-9 list matches the changed destructive decisions. All five own mutants fail: old archive listing3 tests; archive-read throw treated as no holder2; raw read in openCodeNamers1; raw read in ledger namerOf1; kill archive unknown reported as success1. Baseline26 tests pass; adding the own regression gives27 passes. Source restored byte-for-byte in scratch.

Item3(a): every production generation compare also compares launchIdentity: lifecycle272, recovery25/219 and session-manager735/3882/3901. Built probe at14:04:24.201Z proves the floor can repeat generation1 when the old floor2 is mode000. The new reservation has a different identity; actual recovery cleanup rejects the stale assessment and makes0 runtime destroys. Deleting that reservation while the floor is unreadable lowers the persisted floor to1 (.202Z). Mode644→000→644 restored. This is code introduced by the whole fix (blame ef6c73d9), not older code, but no current-manager removal bypass was demonstrated. The absolute never-repeat claim in metadata/docs needs qualification for this failure mode: nonblocking minor contract/documentation issue, not another required archive fix.

Item3(b): own built validator/action probe at14:04:24.207Z reproduces the older behavior. With both liveness probes true but an inaccessible workspace parent, default recovery escalates; escalatePartial:false selects cleanup, destroys the runtime once and archives the record while the workspace survives. Parent755→000→755 restored. The workspace lookup is unchanged9fa0a65e code; the whole-fix diff only adds conservative handling of rejected runtime/agent probes and does not worsen successful-probe behavior. This goes to F-8 under the owner rule.

All requested gates exited0. Full recursive run:2866 tests passed,29 skipped;101 files passed,3 skipped. No B-1/dead-poll live run was repeated, as the brief requested.

## Cleanup and host evidence

All test/helper jobs exited normally; final tool handles returned exit 0. Probe PIDs 1239890 and 1288496 are gone. Own persistent process inventory (excluding the final cleanup helper and its exact ancestors):

```text
[]
```

Private tmux labels `ao47-kr8-tests`, `ao47-kr8-filters`, `ao47-kr8-integration`, `ao47-kr8-full`, and `ao47-kr8-mutants` all answered no server/no socket. No process needed a forced stop. Their exact residual sockets were removed. Protected workers 271579 and 321413 remain present; neither they nor the orchestrator pane was touched. `/tmp/ao47-kr8` (state, scripts, logs, scratch copy and fake HOME) and `/tmp/ao47-kr8-marker` are removed. No mode-000 path remained. Actual modes were archive parent 755 → 000 → 755, sessions parent 755 → 000 → 755, generation floor 644 → 000 → 644 and recovery workspace parent 755 → 000 → 755; tests restored their saved modes. The scratch symlink loop was removed with scratch state.

`ls -la --time-style=full-iso ~/.ao/bin`, before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After (byte-identical):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state check, immediately before marker removal:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr8-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-48
```

The ao-46 file has mtime 2026-10-21 10:09:23.578470270 -0400. Existing worker 271579's observability snapshot (`60756641ca25-observability/processes/lifecycle-manager-271579.json`) records its working → stuck transition at 2026-10-21T14:09:23.579Z, correlation lifecycle-transition-82da7e88-d9b5-422f-ba89-6d7e3e5b45b8. The ao-48 file and sessions directory have mtime 10:10:23.640688258 -0400; the same worker records ao-48's spawning → working transition at 14:10:23.641Z, correlation lifecycle-transition-7e739b91-c7db-4405-b5fa-02b17fd0b70e. The new session's createdAt is 14:09:57.644Z and its issue is same-id-design, an independent orchestrator task. These metadata replacements by the existing worker explain all three final entries. No review helper used the real state root. Earlier checks were empty; the final check reflects this concurrent activity. Real-state evidence was read only through cat, ls, stat and grep, plus the required find.

`git diff --exit-code` and `git diff --check` passed. Prior r2–r7 reviews are byte-identical to their initial hashes; r7 also matches its committed copy at `656f83da`. Review/report only: no source edit, commit, push, PR or done message through AO.
