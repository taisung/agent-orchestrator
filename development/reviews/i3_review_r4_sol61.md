# I-3 re-check, round 4

Whole increment: `b853f74f..ff88bda5`; round 4: `0b21660c..ff88bda5`; HEAD `ff88bda583c0a25a1510597f2cc00af0018d9d05`. Earlier reviews are preserved. No source edits, commit, push or PR. Results were logged and written here incrementally. The author report was read after the independent section 2.1 checks.

## Verdict

LAND-SAFE

M-5 is fixed. New findings: **0 blockers, 0 majors, 1 minor** (m-6, two missing retry-path tests). Both production retry call sites are correct. All section 2.2 live checks completed.

## M-5 reservation ownership

**Fixed.** The fully written, closed claim file is hard-linked to the final name. The name first appears with both keys. All five callers pass the claim; the later helper is gone. Twelve concurrent processes produced one winner, no temporary files. Empty/no-claim compatibility and injected create/write/link failures passed. Temporary names fail metadata validation and were rejected by manager kill/restore/remap.

Own first-visible-record reproducer: on ff88bda5 both CLI kill variants exited 1 and left the claim unchanged; spawn completed. On a scratch 0b21660c build both variants, in separate runs, exited 0 on an empty record; resumed spawn recreated it. The old cases were repeated with both launcher and kill CLI from that old build (i3r4-14 and i3r4-15), with the same result. All fixtures were purged. Detailed checkpoints below.

## Previously unfinished live checks

**All completed.** Actual interrupted prepare with its own branch; dead-owner kill; dead owner with running tmuxName-only pane; legacy unknown-liveness record; worker/orchestrator environment and resolver failures with actual workspace/reservation/prompt cleanup; built b853f74f restore-command comparison with unchanged raw record; live private-socket Herdr native/npm acceptance and preload/shell rejection. No model turn. Evidence below.

## Regressions, gates and mutants

Install/build/typecheck passed. Core **983**; OpenCode **253**; plugin typecheck passed; CLI filter **83** (21 spawn, 32 session, 30 session-utils); integration **87 passed / 24 skipped**; lint **0 errors / 5 existing warnings**; full suite **2378 passed / 29 skipped**.

All gates used env -i, fake HOME, scratch TMPDIR and no inherited AO variables. OpenCode was hidden for filtered integration and during full-suite live-model integration collection; its stand-in was installed after that integration phase while remaining CLI tests finished. No live-model tests ran.

B-1 overlap, B-2 preparation/runtime refusals, tmux/Herdr argv cases, and one warning per no-message worker passed. Prompt-baseline/catalog tests passed; their production code is unchanged this round.

Thirteen separate mutants: **11 caught by committed tests; 2 survive, m-6**. Controlled full-core baseline and both retry mutants each passed 983/983. Two independent added retry probes pass on HEAD and each corresponding mutant fails one. Per-mutant results below.

## Scope and author notes

18 allowed paths across the increment, 5 in round 4; conventional messages with WHY, no co-author trailer, emoji or issue number; no remote contains ff88bda5. I-4 methods/helper/fixtures equal b853f74f.

Other updateMetadata recreation after a removal bypassing the owner guard: **minor retained/dormant risk**, outside corrected claim publication. Hard-link-free filesystem refusal: **minor compatibility restriction and safe refusal**. Existing owner-deferred items remain unchanged.

## Findings and correct behavior

One minor test-coverage finding, m-6, is documented with source lines, evidence and reproducer below. Correct behavior: atomic claim publication, one exclusive winner, temporary/error cleanup, all five claim-bearing paths, no-claim compatibility, launch refusals, dead/legacy holder distinction, environment/resolver rollback, supported argv acceptance/wrong-process rejection, and unchanged restore/I-4 behavior.

## Cleanup

The copied OpenCode service **4066297** and its shell **4066239**, private Herdr server **4097877** and its shell **4097870**, private tmux server **4065455** and control pane **4065456** were stopped by exact PID after command-line, UID and applicable environment checks. All exited. No scratch lifecycle-worker PID file existed. The crashed launcher **4111674**, short-lived liveness fixture, twelve concurrent reservers and subprocess launchers were already stopped/reaped. No protected real lifecycle worker (1815472, 1815599, 1815614, 1815674, 1816016) or global OpenCode service was signalled.

A final /proc environment scan found no scratch descendants. The independent serial process listing, taken after the teardown helper exited, was empty for the scratch path/private server. Before removing the marker, the host find printed nothing. The live lock was empty at both start and end.

```text
ps -o pid,args -u "$(id -u)" [filtered for scratch paths/private server]
[empty]
ls -A /tmp/ao-opencode-launch-44402
[empty]
find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao40-i3-r4-marker
[empty]
```

The before/after `ls -la --time-style=full-iso ~/.ao/bin` listings were identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Earlier review hashes were unchanged:

```text
ac2616d2b5068fb43a9a45a7fd59c894e5650a74cc977b14b7cd9ddb53a1ca98  development/reviews/i3_review_r1_sol61.md
a9d2b9477defd10e7c6aa47694153bfa42b06457fc5567529edd884f28aacfc2  development/reviews/i3_review_r2_sol61.md
57f32a1f4c5f23364170abc8a8ba47a1578e0b04a0594b1da0bcfaf29ca5f923  development/reviews/i3_review_r3_sol61.md
```

The scratch directory and marker were removed after evidence was incorporated here, including the isolated stores/binaries, both base builds, mutation copy, fixtures and logs. No source edit, commit, push, PR or ao done-message send was made. Tracked source diff remains empty.


### Source checkpoint

At `metadata.ts:348–360`, content is written and closed before `linkSync` publishes the record name; temporary cleanup is in `finally`. All five reservation call sites pass the claim (`session-manager.ts:991`, `:1054`, `:1803`, `:1827`, `:1830`). `claimReservedLaunch` is removed. Dot temporary names fail the session-ID validator and are excluded from listing. Independent publication/concurrency/error checks remain pending.

### Independent metadata checkpoint

A Node process observed every synchronous publication boundary: the record was absent until link, then held both claim keys. Twelve simultaneous processes produced one winner and eleven losers with no temporary files. Empty/no-claim compatibility, EEXIST and injected open/write/link errors passed; failures left neither record nor temp. Dot names were excluded and rejected by public metadata APIs. Full observations saved in metadata-independent.json.

### Gate checkpoint

Install and build passed. Core: 983 tests; OpenCode plugin: 253; plugin typecheck passed; CLI spawn/session filter: 83 (includes 30 session-utils tests); integration with OpenCode hidden: 87 passed / 24 skipped. Lint and typecheck passed. Full suite subsequently completed: 2378 passed / 29 skipped, exit 0.

### Reservation base-false

First-visible record i3r4-1: empty; kill exited 0 and deleted it; spawn recreated it. Spawn completed with ses_eadda002cffekFybYTi1PKr1fV; subsequent purge returned record/session counts to zero.

### Reservation base-true

First-visible record i3r4-2: empty; kill exited 0 and deleted it; spawn recreated it. Spawn completed with ses_eadd9cd2effes4rJe2SP24dEC3; subsequent purge returned record/session counts to zero.

### Reservation tip-false

First-visible record i3r4-3: both launch keys present; kill exited 1 and record unchanged. Spawn completed with ses_eadd99a0fffe85T6bZU9x5YjRt; subsequent purge returned record/session counts to zero.

### Reservation tip-true

First-visible record i3r4-4: both launch keys present; kill exited 1 and record unchanged. Spawn completed with ses_eadd96714ffelF1lalyQXHI63t; subsequent purge returned record/session counts to zero.

Mutation checkpoint: empty-then-later-claim: 8 failed / 166 passed in the targeted file(s).

Mutation checkpoint: exclusive-create-then-write: 3 failed / 41 passed in the targeted file(s).

Mutation checkpoint: temp-not-removed: 5 failed / 39 passed in the targeted file(s).

Mutation checkpoint: all-errors-false: 3 failed / 41 passed in the targeted file(s).

Mutation checkpoint: claim-missing-worker: 11 failed / 119 passed in the targeted file(s).

Mutation checkpoint: claim-missing-isolated-orchestrator: 1 failed / 129 passed in the targeted file(s).

Mutation checkpoint: claim-missing-project-first: 3 failed / 127 passed in the targeted file(s).

Mutation checkpoint: claim-missing-project-retry-dead: 0 failed / 130 passed in the targeted file(s).

Mutation checkpoint: claim-missing-project-retry-no-handle: 0 failed / 130 passed in the targeted file(s).

Mutation checkpoint: r3-no-kill-refusal: 6 failed / 124 passed in the targeted file(s).

Mutation checkpoint: r3-first-nonoption: 7 failed / 172 passed in the targeted file(s).

Mutation checkpoint: r3-no-dead-claim: 1 failed / 129 passed in the targeted file(s).

Mutation checkpoint: r3-env-outside: 2 failed / 128 passed in the targeted file(s).

### M-4 crash checkpoint

A separate launcher was stopped and reaped during reused-session preparation with its own branch. Its record had only PID/start/ID. The next delete-strategy spawn removed the old OpenCode ID; killing the dead launcher record worked. Its leftover workspace was explicitly removed.

### M-4 holder checkpoint

A reaped launcher with a live tmuxName-only pane retained its ID during delete. A legacy record with no launch keys or runtime identity retained the ID with the expected liveness-could-not-be-checked warning. All fixture records, sessions and panes were removed.

### Rollback worker/environment

Injected failure rejected the spawn; the real workspace, reservation and any orchestrator prompt file were absent afterward. No runtime was created. Details saved in live-events.jsonl.

### Rollback worker/resolver

Injected failure rejected the spawn; the real workspace, reservation and any orchestrator prompt file were absent afterward. No runtime was created. Details saved in live-events.jsonl.

### Rollback orchestrator/environment

Injected failure rejected the spawn; the real workspace, reservation and any orchestrator prompt file were absent afterward. No runtime was created. Details saved in live-events.jsonl.

### Rollback orchestrator/resolver

Injected failure rejected the spawn; the real workspace, reservation and any orchestrator prompt file were absent afterward. No runtime was created. Details saved in live-events.jsonl.

### Herdr live

Private-socket live confirmation accepted the supported process; workspace and created OpenCode ID removed. Process evidence saved in live-events.jsonl.

### Restore checkpoint

Built the core and OpenCode plugin from b853f74f in scratch. Its getRestoreCommand output equals ff88bda5 with and without an effective model override for a record without launch keys. Both calls leave the raw record unchanged. API-backed fixture session was purged afterward.

### Herdr npm

Private-socket live confirmation accepted the supported process; workspace and created OpenCode ID removed. Process evidence saved in live-events.jsonl.

### Herdr preload

Private-socket live confirmation rejected the stand-in; workspace and created OpenCode ID removed. Process evidence saved in live-events.jsonl.

### Herdr shell

Private-socket live confirmation rejected the stand-in; workspace and created OpenCode ID removed. Process evidence saved in live-events.jsonl.

### Mutation control correction

Two project retry mutants survived the targeted spawn file. The initial whole-core attempt is not valid mutation evidence: two config-discovery tests found the reviewer's scratch YAML in an ancestor directory. The controlled baseline and both mutants were rerun with that YAML temporarily hidden; unrelated discovery failures are excluded from mutation evidence.

### Scope and I-4 checkpoint

Whole increment changes the 18 allowed paths; only 5 changed in round 4. The three round-4 commits are conventional and explain why. Whole-range messages contain no co-author trailer, issue reference or non-ASCII characters. No remote contains ff88bda5. I-4 API helper/tests/fixtures and all five activity/session methods equal b853f74f byte-for-byte.

### Author notes

Other metadata merges can still recreate a manually removed/unprotected record: minor retained/dormant risk, outside the protected live-claim path; not a new M-5 failure. Hard-link-free filesystems now reject preparation-capable spawns with a bounded, explicit reservation error: minor compatibility limit (safe refusal), rather than a return to an unowned record. The existing no-claim fallback when the process start token cannot be read remains an explicitly warned limitation.

### Controlled mutation checkpoint

With the ancestor review YAML temporarily hidden, the unchanged scratch core suite passed 983/983. Omitting the claim at project retry line 1827 also passed 983/983; independently omitting it at line 1830 passed 983/983. The earlier config-discovery failures were environmental and excluded. Both source call sites are correct; targeted scratch tests for the two missing branches are now being evaluated.

### Completed deferred checks

All section 2.2 live cases have now run: interrupted preparation with its own branch; successful dead-owner kill; live tmuxName-only pane protection; legacy unknown-liveness protection; worker/orchestrator environment and resolver exceptions with resource rollback; b853f74f restore-command/raw-record comparison; real Herdr on a private scratch socket. Herdr native/npm passed and preload/shell failed confirmation. No model turn ran.

### B-2 prepare

Both CLI kill variants exited 1 with the owner refusal; record unchanged. Spawn completed with a live ID and exactly one prompt warning; subsequent purge succeeded.

### B-2 runtime

Both CLI kill variants exited 1 with the owner refusal; record unchanged. Spawn completed with a live ID and exactly one prompt warning; subsequent purge succeeded.

### B-1 overlap

With the first spawn paused at runtime.create and status overwritten to killed, a second delete-strategy spawn retained the first ID and created a distinct second ID. Both completed and cleared their launch keys. Both were purged.

## m-6 — Project-orchestrator retry reservations lack regression tests

**Defect:** the new orchestrator reservation tests cover the first project reservation, but do not force either retry reservation after a concurrent collision. A future omission of the claim on those paths would reopen M-5 without failing the committed suite. The two production calls are correct at HEAD; this is a minor test gap.

**File and line:** `packages/core/src/__tests__/session-manager/spawn.test.ts:3316`. The uncovered calls are `packages/core/src/session-manager.ts:1827` and `:1830`.

**Evidence:** the controlled unchanged whole-core suite passed 983/983. Removing the claim argument at line 1827 independently still passed 983/983; restoring it and removing the claim at line 1830 also passed 983/983. The targeted spawn file passed 130/130 for each. Two additional scratch probes passed on HEAD and each failed on its corresponding mutation. The earlier unrelated config-discovery failures were excluded.

**Reproducer:** in a scratch archive, omit the third `reserveSessionId` argument at line 1827 and run the complete core suite; restore and repeat at line 1830. To catch the regressions, stage a concurrent reservation after the existing-record read. First leave a dead runtime record so the dead-record retry runs; separately remove the concurrent record before reread so the no-handle retry runs. On the successful reservation, start a kill immediately and assert that the record already has both keys and the kill is refused. Both added probes pass on the unchanged implementation and reject the corresponding omission.

### Tmux argv regression

Real preload-only and shell-only stand-ins failed confirmation and rolled back; final active records and isolated sessions were empty. Supported forms also passed on the private Herdr server.

### Reservation matched-build-base-false

First-visible record i3r4-14: empty; kill exited 0 and deleted it; spawn recreated it. Spawn completed with ses_eadd1a93affecuLiFckbyYzjpw; subsequent purge returned record/session counts to zero.

### Reservation matched-build-base-true

First-visible record i3r4-15: empty; kill exited 0 and deleted it; spawn recreated it. Spawn completed with ses_eadd176ecffevzNIhfEhrDdF6c; subsequent purge returned record/session counts to zero.

## Final evidence summary

The reservation implementation is at `metadata.ts:348–361`; claim-bearing call sites are `session-manager.ts:991`, `:1054`, `:1803`, `:1827`, `:1830`.

| Mutant | Failed tests in targeted file(s) |
| --- | ---: |
| Empty reservation then later claim | 8 |
| Exclusive create then in-place write | 3 |
| Temporary file not removed | 5 |
| All errors return false | 3 |
| Worker claim omitted | 11 |
| Isolated orchestrator claim omitted | 1 |
| Project first claim omitted | 3 |
| Project dead-record retry claim omitted | 0 (m-6) |
| Project no-handle retry claim omitted | 0 (m-6) |
| B-2 kill refusal removed | 6 |
| M-3 first-non-option parser | 7 |
| M-4 dead-claim exception removed | 1 |
| m-5 environment outside rollback | 2 |

Source and live evidence distinguish the two correct production retry paths from their surviving committed-suite mutants. Added probes pass 2/2 on HEAD; each mutant fails its corresponding probe. Initial whole-core config-discovery failures were caused by ancestor review YAML, discarded, and rerun with a clean control.

Live safety setup: copied OpenCode 2.0.31, PID **4066297**, port **49646**; /proc confirmed its copied executable and all four scratch XDG roots before writes, distinct from global PID 3252262. No service credential file read. Private tmux **4065455**, persistent control pane **4065456**, inspected scratch HOME/no AO environment; every tmux call used its private socket shim. Private Herdr server **4097877**, scratch socket/config/HOME/XDG, version/manifest background checks disabled. No real TUI/model turn.

M-4's interrupted launcher **4111674** was stopped and reaped, after its record contained only PID/start/reused ID; the subsequent delete removed the old ID, and the dead record could be killed. A live tmuxName-only holder retained its ID; the legacy holder retained its ID with the expected unknown-liveness warning. All four environment/resolver failure cases removed actual managed workspaces and reservations, and the two orchestrator cases removed their prompt files. Old/new restore commands matched and left raw metadata unchanged.

B-1 retained two distinct IDs after status=killed while the first spawn waited at runtime.create. B-2 CLI kills both refused during prepare and runtime.create, with unchanged records and successful later spawns. Each no-message worker emitted one warning. Tmux and Herdr rejected preload/shell stand-ins; Herdr accepted native/npm forms. Final harness had zero active records/sessions; Herdr workspace list was empty, and only the private tmux control pane remained.

No mandatory section 2.2 check remains not run. The first-poll race and tool-environment measurement remain deferred by owner instruction. Cleanup follows.
