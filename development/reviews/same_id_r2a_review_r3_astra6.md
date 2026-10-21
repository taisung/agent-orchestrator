# Same-ID R2a round-3 independent re-check

NOT-LAND-SAFE

Finding counts: 0 B, 1 M, 0 m; 4 follow-ups retained. **M-1 blocks landing:** a completed first-party bash metadata update is still deleted by a refused archived restore. The Node/public-claim cases are fixed; the predicate does not cover the shipped writers that preserve generation. F-4's reservation-not-lock text is fixed. All required gates pass, red counts remain 44, and all three required mutants are caught.

Completed short re-check of round 3 `3612c2fd..c045f31b`; whole R2a `cbfbc182..c045f31b`. Prior unchanged source retains rounds 1 and 2 results. No production code edits, commits, push or PR. The author report was read after independent items 1–2 source review. Chronological evidence below precedes the final assessment.

Marker `/tmp/aor2ar3-marker` created before work. Every node/pnpm/helper/test/live CLI process runs under env -i, HOME=/tmp/aor2ar3/home, PATH=/tmp/aor2ar3/bin:/usr/bin:/bin, TMPDIR=/tmp/aor2ar3/tmp (live PATH may prepend its own private shim). No AO variables in tests; scratch-only AO config/state for live. gh stub allows only version/auth status; no model binary on PATH. tmux shim forces private server aor2ar3-test57, no config and unset TMUX. Every live server starts with no AO variables. Owned PIDs will be recorded and cleaned by exact PID; protected processes are untouched.

Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Independent items 1–2 source assessment (before the author report)

The new predicate combines the exact reserved generation with launch identity under deleteMetadata's record lock. Node updateMetadata/updateMetadataIf/full write all increment generation and strip caller-supplied generation; delete preserves the floor, and a new reservation/full recreation continues above it. Thus the previous public claim and metadata-update counterexamples should now retain their active record. Same-launch higher-generation records have an explicit changed/kept message; different launch and gone have separate branches. Read-only reads do not increment generation, but status repair/lifecycle writes may, even for values a caller considers bookkeeping. Conservative retention is appropriate if the message tells the user it is active and must be inspected before retry.

The bash shared helper and Claude hook still write PR/status/branch via temp-file rename, preserving generation and reservation. A completed helper write before the new delete is therefore invisible to this predicate; this is distinct from the broader existing race where an unlocked helper writes between another operation's read and rename. I will reproduce the completed-write case and compare it with the pre-unwind version before classifying it.

F-4 source comment now explicitly lists another restore, orchestrator start, PR claim, kill and lifecycle write as able to act on the active copy-back. DEVELOPMENT.md also makes this distinction. The reservation claim is narrowed to exclusive reservation creation, not operation exclusion. The text says any write keeps the record, despite the documented helper exception elsewhere; that claim needs the same experiment.

## Measured predicate boundary

The three original reviewer tests are rerun from the round-2 review verbatim: on c045f31b all three pass (metadata update retained; public claim retained; concurrent active restore still enters). The new attack matrix also confirms clean read-only listing unwinds; no-op Node status updates and list-triggered orchestrator repairs retain and report the active copy-back; full writes cannot retain the old generation; archive-only removal is reported gone; new reservation survives; archive-only updates remain in the archive.

Four completed bash writes still disappear: shared helper PR, shared helper status, shared helper branch, and Claude hook PR. They run the actual exported helper/hook functions, finish successfully inside the controlled stop, and keep generation 2. After stop returns unknown, active=null and the untouched generation-1 archive lacks the helper's change. Each preservation assertion passes on ac1cbf4b (before releaseCopyBack existed), fails on 3612c2fd, and still fails on c045f31b. Thus the pre-existing lack of helper locking is not itself the new finding; the changed refusal unwind newly deletes an already-completed first-party write. The author explicitly acknowledges deletion of helper updates, but treating it as the same as every other compare misses this completed-before-read case. Other guards already compare helper-mutable fields in addition to generation.

The attack matrix intentionally expects the new clean unwind for read-only/list and archive-update controls; those two assertions fail on ac1cbf4b because that version leaves the active copy-back. They are not pre-existing defects newly attributed to this round. Per-case outputs will be retained below.

## Live rebuilt-code evidence and mutant results

Build completed successfully before the live harness. Public `sm.claimPR` now succeeds and stays after the refusal: generation 3, PR 99, branch feat/claimed, status pr_open, same reservation, archive hash unchanged, same private pane. SCM resolution was an in-process local answer, checkout was real `/usr/bin/git switch -c` in a scratch worktree; no gh/network call. The optional runtime stop was a controlled unknown with the real pane kept alive.

The same harness executes the built shared helper, which exits 0 after setting PR 100, pr_open, and feat/helper. Its real git worktree is on feat/helper. During stop the active record holds those fields at generation 2; after refusal it is absent, while the old archive still names feat/rv-helper-completed and no PR. Pane PID 2335485 on private server 2335449 is unchanged. This confirms the source counterexample on the final build without a model process.

A real `ao session ls --project review` during another stop is read-only for that ordinary record: generation remains 2, and unwind removes it normally. A no-op Node status write increments 2 to 3 and retains the active copy-back; its new refusal clearly names the active record, inspection with `ao session ls`, and subsequent restore. That conservative retention is acceptable. Full-write, archive/re-reserve and gone branches were covered separately in the source matrix.

Independent mutants on the 112 helper/caller tests: control 112 pass; generation removed 3 fail (metadata update, public claim, status write); unconditional delete 4 fail (those three plus different-reservation replacement); changed-record message branch removed 3 fail (those three at the message assertion, after disk assertions pass). Each mutation is isolated in the archived scratch copy and restored afterward.

## Required gates and red comparison

All commands ran in the review worktree with the clean environment above. Scratch source copies use source aliases (including core subpaths) and symlinks to installed dependencies; no scratch builds. Frozen install and build preceded live use.

```text
== install (exit 0)
Scope: all 15 workspace projects
Done in 2.3s
== build (exit 0)
Scope: 14 of 15 workspace projects
packages/core build: Done
packages/plugins/agent-gemini build: Done
packages/plugins/agent-claude-code build: Done
packages/plugins/agent-codex build: Done
packages/plugins/agent-opencode build: Done
packages/plugins/notifier-desktop build: Done
packages/plugins/scm-github build: Done
packages/plugins/runtime-herdr build: Done
packages/plugins/runtime-tmux build: Done
packages/plugins/tracker-github build: Done
packages/plugins/workspace-worktree build: Done
packages/cli build: Done
== typecheck (exit 0)
Scope: 14 of 15 workspace projects
packages/core typecheck: Done
packages/plugins/agent-gemini typecheck: Done
packages/plugins/agent-claude-code typecheck: Done
packages/plugins/agent-codex typecheck: Done
packages/plugins/agent-opencode typecheck: Done
packages/plugins/notifier-desktop typecheck: Done
packages/plugins/runtime-herdr typecheck: Done
packages/plugins/scm-github typecheck: Done
packages/plugins/runtime-tmux typecheck: Done
packages/plugins/tracker-github typecheck: Done
packages/plugins/workspace-worktree typecheck: Done
packages/integration-tests typecheck: Done
packages/cli typecheck: Done
== lint (exit 0)
✖ 5 problems (0 errors, 5 warnings)
== filtered (exit 0)
Scope: 6 of 15 workspace projects
packages/core test:  Test Files  57 passed (57)
packages/core test:       Tests  1545 passed | 11 expected fail (1556)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/workspace-worktree test:  Test Files  4 passed (4)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
== full (exit 0)
Scope: 14 of 15 workspace projects
packages/core test:  Test Files  57 passed (57)
packages/core test:       Tests  1545 passed | 11 expected fail (1556)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  220 passed (220)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  4 passed (4)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:  Test Files  4 passed (4)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

Commands: `pnpm install --frozen-lockfile` (HUSKY=0), `pnpm build`, `pnpm typecheck`, `pnpm lint`, the six requested package test filters (core, CLI, both runtimes, worktree, integration), and one `pnpm -r --no-bail test`. Integration agent-dependent cases skipped with no model binary on PATH; its tmux cases ran through the private shim. Lint retains the same five warnings.

SAME_ID_DEFECTS=red, all marked files including same-id-reuse-window:

| Round | 3612c2fd failed / passed | c045f31b failed / passed |
| --- | --- | --- |
| R1 | 0 / 17 | 0 / 17 |
| R2 | 16 / 20 | 16 / 20 |
| R3 | 6 / 0 | 6 / 0 |
| R4 | 22 / 11 | 22 / 11 |

Changed individual assertion outcomes: []. Total failed remains 44.

## Final finding: M-1 — completed shell-helper writes still match the delete predicate

**Major; retained in changed R2a code, introduced by round 2's refusal unwind. Blocks landing.** Location: `packages/core/src/session-manager.ts:1575`–1579 (predicate and delete; the predicate has only launch identity plus generation). Related shipped writers: `packages/core/src/agent-workspace-hooks.ts:254` (shared helper), `packages/plugins/agent-claude-code/src/index.ts:144` (hook).

The generation guard fixes writers that advance generation. Both shipped bash writers instead preserve it while replacing the file. Their allowed PR/status/branch updates also preserve every launch-identity field. If such a write finishes during the awaited stop, the new locked read sees the updated record, considers it unchanged, and unlinks it with no archive. This loses the completed write and hides the record even though the original runtime may still run.

Reproducer, actual helper code and deterministic ordering, no network/model:

1. Write a killed record with its runtime handle and scratch worktree, then archive it. The archive has generation 1.
2. Begin restore; it writes its active copy-back with generation 2 and a reservation ID.
3. During the controlled awaited stop, source the exported `AO_METADATA_HELPER` in clean bash with scratch `AO_DATA_DIR` and `AO_SESSION`. Call `update_ao_metadata pr https://github.com/review/scratch/pull/100`, `update_ao_metadata status pr_open`, and `update_ao_metadata branch feat/helper`. Wait for bash to exit 0. In the live fixture, a real git checkout also moves the worktree to feat/helper.
4. The active record visibly contains those completed updates at generation 2. Only then let stop answer unknown. No helper write overlaps the deletion's read/unlink critical section.
5. Active record becomes null. The unchanged generation-1 archive names the old branch and no PR, while the real worktree remains on feat/helper and the same pane still runs. The refusal incorrectly takes the clean-copy-back branch, with no warning that a completed update was discarded.

Source assertions for shared PR, status, branch, and the Claude hook PR all pass at ac1cbf4b (before this unwind), fail at 3612c2fd, and fail at c045f31b. The built-code live case independently shows the same loss. This is not a newly invented requirement that all bash writers acquire the Node lock: their lack of locking is older, but deleting their already-completed write is new in R2a and remains in the exact function changed by round 3. The broader old race where an unlocked writer acts *between* read and unlink is a separate limit.

The author's statement “No helper runs for a killed record without an agent” is not a sufficient precondition. Neither archived/killed metadata nor an unconfirmed runtime stop proves that a surviving shell, an earlier command, or its metadata helper cannot write. Restoring an archive whose old pane survives is an explicit supported case already exercised in rounds 1–2. No model process is required for a git wrapper/helper to execute.

**Bounded correction:** compare the helper-mutable fields `pr`, `status`, and `branch` from the reserved snapshot as well as generation/launch identity before deletion, and retain/report a mismatch. A scratch-only control adding these three expected fields passes **126/126 tests** (112 existing helper/caller tests + the 3 previous reviewer tests + 11 new attacks). This mirrors the existing repair-on-read checks for helper fields and fixes the demonstrated completed-before-read case without claiming to solve the unlocked-writer or operation-serialization problem. Tighten the comment/docs claim that “any write” is detected to match the actual predicate. No production patch was made.

## M-1 and F-4 disposition; predicate and message assessment

- **Previous M-1: partly fixed.** All three original reviewer tests pass verbatim on the tip, and the built public PR claim survives with its exact claimed record. Node writes, including no-op updates, are protected; the completed helper-write case above remains.
- **F-4 text: fixed.** The code comment near 4354–4363 and both relevant DEVELOPMENT.md paragraphs explicitly say another active-record restore, claim, kill, orchestrator start or lifecycle write can still act. The author report identifies and retracts the overbroad round-2 sentences. No remaining reservation claim in the changed text excludes those operations. Actual serialization remains a follow-up.
- **Full write:** writeMetadata strips caller generation/reservation input and advances the active generation; the full-write attack survives. It may be described as a replacement when reservation identity is removed, which is accurate for the stored identity.
- **Archive/delete/reserve:** deletion raises the floor; a new reservation has another ID and a later generation. The new reservation survives. An archive-only removal is reported gone; a separate archive update remains in that archive after clean copy-back release. An arbitrary raw file rename can evade a generation predicate; the shipped helpers are the concrete supported rename path demonstrated here, rather than a hypothetical disk editor.
- **Read-only vs write-on-read:** ordinary sm.list and actual CLI session ls leave generation unchanged, so a clean unwind still succeeds. Orchestrator role/PR-policy repair on list advances generation and is retained. A same-value status update also advances generation and is retained. This is conservative and acceptable: a generation is a write version, not semantic equality. Source inspection shows an unchanged lifecycle classification does not automatically persist status, but lifecycle bookkeeping/repair writes use the same generation-advancing API. The author status test is an updateMetadata simulation of such a write, not proof that every poll writes.
- **What the owner sees:** a retained higher-generation copy-back is active, keeps the concurrent update, and remains subject to normal active-record restorability. The changed-record message correctly names this and tells the owner to inspect `ao session ls` before restoring; the separate Next line tells them to inspect/stop the runtime before retry. A still-running agent can make the next restore refuse as nonterminal; the advice is conditional, not a promise that retry will succeed. No additional availability finding for retaining a harmless write.
- **Gone/changed/replaced:** their record-specific branches are correct for the independently tested cases. The changed branch is non-vacuously tested by its mutant. The shared tail “the workspace is as it was” should be understood as this restore making no workspace change, not a guarantee that another concurrent claim did not check out a different branch (the live claim does). That unchanged round-2 tail is not a new round-3 blocker; precise future wording would be “this restore did not change the workspace.” The helper case incorrectly selects clean unwind because of M-1.

## Independent test matrix

| Case | ac1cbf4b (pre-unwind) | 3612c2fd | c045f31b |
| --- | --- | --- | --- |
| Original reviewer metadata update | pass | fail | pass |
| Original reviewer public claim | pass | fail | pass |
| Original reviewer second restore admission | pass | pass | pass |
| Shared helper PR/status/branch (3) | 3 pass | 3 fail | 3 fail |
| Claude hook PR | pass | fail | fail |
| Same-value Node status update | pass | fail | pass |
| Full write | pass | pass | pass |
| Archive-only gone | pass | pass | pass |
| Archive then new reservation | pass | pass | pass |
| Archive update; expect clean active unwind | fail (old copy-back remains) | pass | pass |
| Read-only list; expect clean active unwind | fail (old copy-back remains) | pass | pass |
| List repair of orchestrator metadata | pass | fail | pass |

The two expected pre-unwind control failures are not counted as findings. Tip reviewer-only total: 10 pass, 4 fail; the four failures are all M-1 variants. The old three tests were extracted directly from the round-2 review artifact, not rederived from the author's new test file.

## Mutants

Each mutation was made independently in an archived scratch copy of c045f31b, then restored. Both runtime-stop test files (112 tests) ran each time.

| Mutation | Failed / passed | Failing tests |
| --- | --- | --- |
| Control | 0 / 112 | None |
| Remove generation from predicate | 3 / 109 | reviewer metadata update; reviewer successful public PR claim; author's lifecycle-style status write; all fail at disk preservation |
| Make delete unconditional | 4 / 108 | Those three plus different-reservation replacement preservation |
| Remove changed-record message branch | 3 / 109 | Same metadata/claim/status tests; disk passes, exact changed/kept/next message assertion fails |

The new tests preserve the reviewer's original assertions and add useful record/archive/workspace and diagnostic checks. They cover generation-advancing writers; none exercises the helper protocol, which is why the official suite is green despite M-1.

## Scope, commits, correct changes, and whole-R2a verdict

Only the authorized three files changed: session-manager.ts, runtime-stop-callers.test.ts, docs/DEVELOPMENT.md; +197 -14. Runtime-stop, types, CLI (including send), plugins, lifecycle-manager and recovery diffs are empty. The source change is the delete predicate, refusal branching and specified comments. No unrelated caller changes.

Both commits have conventional subjects and explanatory WHY bodies, no Co-Authored-By, emoji or issue numbers. Single-parent chain: 3612c2fd → c050abc6 → c045f31b. `git branch -r --contains c045f31b` prints nothing; no fetch/network command was used.

Correct: Node-write preservation under the record lock, public claim retention, unchanged clean unwind, replacement/gone handling, honest active-copy-back guidance, non-vacuous tests, and corrected reservation-vs-operation text. The round-1 stop/lifecycle results and round-2 helper exception handling and scoped CLI diagnostics remain unchanged.

**Whole R2a `cbfbc182..c045f31b`: NOT-LAND-SAFE.** One major M-1 blocks landing: completed first-party helper writes are still destroyed by the changed refusal unwind. No blocker-category or minor-category finding. This is a residual case of the prior major, not a demand to absorb every older same-ID problem.

Follow-ups, unchanged and nonblocking for this review:

1. **F-1:** old kill skip guards for missing/malformed runtime identity or unloaded plugin.
2. **F-2:** recovery's existing runtimeAlive=false trust; validator probe rejection already selects skip.
3. **F-3:** residual send.ts refusal presentation, in ao-54's scope; the other round-2 diagnostics remain fixed.
4. **F-4:** existing operation/workspace serialization, including another active-record restore entering. The misleading reservation text is now fixed; no claim that the operation race is closed.

The older general lack of coordination between shell helpers and locked Node writes remains the documented limit; the M-1 correction requested here is limited to detecting their *completed* changes before release.

## Reproducers and retained raw evidence

New attack source, saved here before scratch removal. Run it as core/src/__tests__/review-r3.test.ts in a git-archive copy using local Vitest and core source aliases. All helper calls inherit the fake environment and receive only scratch AO paths.

```ts
import {it,expect,vi} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {setupTestContext,teardownTestContext,makeHandle} from './test-utils.js';
import {createSessionManager} from '../session-manager.js';
import {writeMetadata,readMetadataRaw,readArchivedMetadataRaw,updateMetadata,deleteMetadata,reserveSessionRecord,updateArchivedMetadata} from '../metadata.js';
import {getWorktreesDir} from '../paths.js';
import {AO_METADATA_HELPER} from '../agent-workspace-hooks.js';
import {METADATA_UPDATER_SCRIPT} from '../../../plugins/agent-claude-code/src/index.js';

const modes=['shared-pr','shared-status','shared-branch','claude-pr','noop-update','full-write','archive-only','archive-and-reserve','archive-update','read-only-list','repair-on-list'] as const;
for(const mode of modes)it(`review attack: ${mode}`,async()=>{
 const c=setupTestContext();
 try{
  const id=mode==='repair-on-list'?'app-orchestrator':'app-1';
  const wt=join(getWorktreesDir(c.config.configPath,c.config.projects['my-app']!.path),id);
  mkdirSync(wt,{recursive:true});
  writeMetadata(c.sessionsDir,id,{project:'my-app',worktree:wt,branch:'feat/original',status:'killed',runtimeHandle:JSON.stringify(makeHandle('rt-old'))});
  deleteMetadata(c.sessionsDir,id,true);
  const sm=createSessionManager({config:c.config,registry:c.mockRegistry});
  let original:Record<string,string>|null=null,written:Record<string,string>|null=null;
  c.mockRuntime.stop=vi.fn(async()=>{
   original=readMetadataRaw(c.sessionsDir,id);
   if(mode.startsWith('shared-')){
    const key=mode.slice(7),value=key==='pr'?'https://github.com/review/scratch/pull/99':key==='status'?'pr_open':'feat/helper';
    const path=join(c.tmpDir,'shared-helper.sh');writeFileSync(path,AO_METADATA_HELPER);
    execFileSync('/bin/bash',['--noprofile','--norc','-c','source "$1"; update_ao_metadata "$2" "$3"','review',path,key,value],{env:{...process.env,AO_DATA_DIR:c.sessionsDir,AO_SESSION:id},encoding:'utf8'});
   }else if(mode==='claude-pr'){
    const functions=['hook_is_safe_branch','hook_is_safe_pr','update_metadata_key'].map(name=>{
     const match=METADATA_UPDATER_SCRIPT.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}','m'));if(!match)throw Error('missing hook function');return match[0];
    }).join('\n');
    const path=join(c.tmpDir,'hook-functions.sh');writeFileSync(path,functions);
    execFileSync('/bin/bash',['--noprofile','--norc','-c','metadata_file="$2"; source "$1"; update_metadata_key pr "$3"','review',path,join(c.sessionsDir,id),'https://github.com/review/scratch/pull/99'],{env:process.env,encoding:'utf8'});
   }else if(mode==='noop-update')updateMetadata(c.sessionsDir,id,{status:original!.status});
   else if(mode==='full-write')writeMetadata(c.sessionsDir,id,{...original!,generation:'1',status:'pr_open',pr:'https://github.com/review/scratch/pull/99'});
   else if(mode==='archive-only')deleteMetadata(c.sessionsDir,id,true);
   else if(mode==='archive-and-reserve'){deleteMetadata(c.sessionsDir,id,true);reserveSessionRecord(c.sessionsDir,id,{...original!,status:'working'});}
   else if(mode==='archive-update')updateArchivedMetadata(c.sessionsDir,id,{pr:'https://github.com/review/scratch/pull/99'});
   else await sm.list('my-app');
   written=readMetadataRaw(c.sessionsDir,id);
   console.log('DURING',JSON.stringify({mode,original,written,archive:readArchivedMetadataRaw(c.sessionsDir,id)}));
   return {outcome:'unknown',detail:'controlled refusal'};
  });
  const err=await sm.restore(id).catch((e:unknown)=>e);
  const after=readMetadataRaw(c.sessionsDir,id);
  console.log('AFTER',JSON.stringify({mode,after,archive:readArchivedMetadataRaw(c.sessionsDir,id),message:(err as Error).message,workspace:existsSync(wt)}));
  expect((err as Error).message).toContain('runtime stop unconfirmed');
  expect(c.mockRuntime.create).not.toHaveBeenCalled();
  if(['archive-only','archive-update','read-only-list'].includes(mode))expect(after).toBeNull();
  else expect(after,'completed writer lost').toEqual(written);
  if(mode==='noop-update')expect(Number(written!.generation)).toBe(Number(original!.generation)+1);
  if(mode==='full-write')expect(Number(written!.generation)).toBeGreaterThan(Number(original!.generation));
  if(mode==='read-only-list')expect(written).toEqual(original);
  if(mode==='archive-update')expect(readArchivedMetadataRaw(c.sessionsDir,id)?.pr).toBe('https://github.com/review/scratch/pull/99');
 }finally{teardownTestContext(c);}
});
```

The three old tests are retained verbatim in the round-2 review under Reproduction artifacts.

Live build snapshots (name|server PID|pane PID; real local git worktrees; stop answer injected; SCM resolution local; no model/network):

```text
BEFORE public-claim {"active":null,"archive":[{"name":"rv-public-claim_2026-10-21T21-35-00-156Z","sha256":"3611f0bb5a933036e4ea327277107135f0ee2aebe2f205a757823b3996186900","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-public-claim\nbranch=feat/rv-public-claim\nstatus=killed\ntmuxName=review-rv-public-claim\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-public-claim\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-public-claim","listSessions":"review-rv-public-claim|2335449|2335450\n"}
CLAIM {"sessionId":"rv-public-claim","projectId":"review","pr":{"number":99,"url":"https://github.com/review/scratch/pull/99","title":"Scratch claim","owner":"review","repo":"scratch","branch":"feat/claimed","baseBranch":"main","isDraft":false},"branchChanged":true,"githubAssigned":false,"takenOverFrom":[]}
DURING public-claim {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-public-claim","branch":"feat/claimed","status":"pr_open","tmuxName":"review-rv-public-claim","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-public-claim\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"8c5b928d-f039-4eff-b8dd-88bad66d3de6","generation":"3","pr":"https://github.com/review/scratch/pull/99"},"archive":[{"name":"rv-public-claim_2026-10-21T21-35-00-156Z","sha256":"3611f0bb5a933036e4ea327277107135f0ee2aebe2f205a757823b3996186900","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-public-claim\nbranch=feat/rv-public-claim\nstatus=killed\ntmuxName=review-rv-public-claim\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-public-claim\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/claimed","listSessions":"review-rv-public-claim|2335449|2335450\n"}
REFUSAL public-claim {"message":"runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of rv-public-claim with that write and was not removed; the workspace is as it was, and no new runtime was created; check that record with `ao session ls` before you restore again, because a restore now reads the active record and not the archive","hint":"Check tmux session review-rv-public-claim by hand and stop it if it still runs, then run `ao session restore rv-public-claim` again. AO goes on only when the runtime answers that the session stopped or does not exist."}
AFTER public-claim {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-public-claim","branch":"feat/claimed","status":"pr_open","tmuxName":"review-rv-public-claim","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-public-claim\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"8c5b928d-f039-4eff-b8dd-88bad66d3de6","generation":"3","pr":"https://github.com/review/scratch/pull/99"},"archive":[{"name":"rv-public-claim_2026-10-21T21-35-00-156Z","sha256":"3611f0bb5a933036e4ea327277107135f0ee2aebe2f205a757823b3996186900","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-public-claim\nbranch=feat/rv-public-claim\nstatus=killed\ntmuxName=review-rv-public-claim\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-public-claim\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/claimed","listSessions":"review-rv-public-claim|2335449|2335450\n"}
BEFORE helper-completed {"active":null,"archive":[{"name":"rv-helper-completed_2026-10-21T21-35-00-339Z","sha256":"db4ef0a63fb73fa29c18d4d8671ec8e70874b125ea88b1994fe2e1f7eb560211","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-helper-completed\nbranch=feat/rv-helper-completed\nstatus=killed\ntmuxName=review-rv-helper-completed\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-helper-completed","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\n"}
HELPER_COMPLETED {"status":0,"stdout":"","stderr":""}
DURING helper-completed {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-helper-completed","branch":"feat/helper","status":"pr_open","tmuxName":"review-rv-helper-completed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"67cb0321-1fb6-4e6b-baec-1a0c5312f301","generation":"2","pr":"https://github.com/review/scratch/pull/100"},"archive":[{"name":"rv-helper-completed_2026-10-21T21-35-00-339Z","sha256":"db4ef0a63fb73fa29c18d4d8671ec8e70874b125ea88b1994fe2e1f7eb560211","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-helper-completed\nbranch=feat/rv-helper-completed\nstatus=killed\ntmuxName=review-rv-helper-completed\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/helper","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\n"}
REFUSAL helper-completed {"message":"runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; nothing was restored: the archive copy-back of this restore was removed again, the workspace is as it was, and no new runtime was created","hint":"Check tmux session review-rv-helper-completed by hand and stop it if it still runs, then run `ao session restore rv-helper-completed` again. AO goes on only when the runtime answers that the session stopped or does not exist."}
AFTER helper-completed {"active":null,"archive":[{"name":"rv-helper-completed_2026-10-21T21-35-00-339Z","sha256":"db4ef0a63fb73fa29c18d4d8671ec8e70874b125ea88b1994fe2e1f7eb560211","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-helper-completed\nbranch=feat/rv-helper-completed\nstatus=killed\ntmuxName=review-rv-helper-completed\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"2","workspace":[".git","README"],"branch":"feat/helper","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\n"}
BEFORE readonly-status {"active":null,"archive":[{"name":"rv-readonly-status_2026-10-21T21-35-00-563Z","sha256":"74442d63b1e0a95e478d3a04d3b2a04060159b1aff08fa2e4d3b30097759fbe3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-readonly-status\nbranch=feat/rv-readonly-status\nstatus=killed\ntmuxName=review-rv-readonly-status\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-readonly-status\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-readonly-status","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
CLI_STATUS {"status":0,"stdout":"\nReview:\n  rv-public-claim  (0s ago)  feat/claimed  [pr_open]  https://github.com/review/scratch/pull/99\n  rv-readonly-status  (0s ago)  feat/rv-readonly-status  [killed]\n\n","stderr":""}
DURING readonly-status {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-readonly-status","branch":"feat/rv-readonly-status","status":"killed","tmuxName":"review-rv-readonly-status","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-readonly-status\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"7634dd34-e768-4518-8551-71626cd1749f","generation":"2"},"archive":[{"name":"rv-readonly-status_2026-10-21T21-35-00-563Z","sha256":"74442d63b1e0a95e478d3a04d3b2a04060159b1aff08fa2e4d3b30097759fbe3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-readonly-status\nbranch=feat/rv-readonly-status\nstatus=killed\ntmuxName=review-rv-readonly-status\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-readonly-status\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-readonly-status","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
REFUSAL readonly-status {"message":"runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; nothing was restored: the archive copy-back of this restore was removed again, the workspace is as it was, and no new runtime was created","hint":"Check tmux session review-rv-readonly-status by hand and stop it if it still runs, then run `ao session restore rv-readonly-status` again. AO goes on only when the runtime answers that the session stopped or does not exist."}
AFTER readonly-status {"active":null,"archive":[{"name":"rv-readonly-status_2026-10-21T21-35-00-563Z","sha256":"74442d63b1e0a95e478d3a04d3b2a04060159b1aff08fa2e4d3b30097759fbe3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-readonly-status\nbranch=feat/rv-readonly-status\nstatus=killed\ntmuxName=review-rv-readonly-status\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-readonly-status\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"2","workspace":[".git","README"],"branch":"feat/rv-readonly-status","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
BEFORE noop-write {"active":null,"archive":[{"name":"rv-noop-write_2026-10-21T21-35-01-009Z","sha256":"4d6ea87d01b43aa74d5c7e61da27a9cf1cee1a1a511140bbc54f21cda05395a3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-noop-write\nbranch=feat/rv-noop-write\nstatus=killed\ntmuxName=review-rv-noop-write\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-noop-write\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-noop-write","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-noop-write|2335449|2335735\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
DURING noop-write {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-noop-write","branch":"feat/rv-noop-write","status":"killed","tmuxName":"review-rv-noop-write","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-noop-write\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"b3ca825a-71b0-48c5-ac6c-7b62d6a70506","generation":"3"},"archive":[{"name":"rv-noop-write_2026-10-21T21-35-01-009Z","sha256":"4d6ea87d01b43aa74d5c7e61da27a9cf1cee1a1a511140bbc54f21cda05395a3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-noop-write\nbranch=feat/rv-noop-write\nstatus=killed\ntmuxName=review-rv-noop-write\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-noop-write\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-noop-write","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-noop-write|2335449|2335735\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
REFUSAL noop-write {"message":"runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of rv-noop-write with that write and was not removed; the workspace is as it was, and no new runtime was created; check that record with `ao session ls` before you restore again, because a restore now reads the active record and not the archive","hint":"Check tmux session review-rv-noop-write by hand and stop it if it still runs, then run `ao session restore rv-noop-write` again. AO goes on only when the runtime answers that the session stopped or does not exist."}
AFTER noop-write {"active":{"worktree":"/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-noop-write","branch":"feat/rv-noop-write","status":"killed","tmuxName":"review-rv-noop-write","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-noop-write\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"b3ca825a-71b0-48c5-ac6c-7b62d6a70506","generation":"3"},"archive":[{"name":"rv-noop-write_2026-10-21T21-35-01-009Z","sha256":"4d6ea87d01b43aa74d5c7e61da27a9cf1cee1a1a511140bbc54f21cda05395a3","record":"worktree=/tmp/aor2ar3/live/state/fbd05bb17d17-repo/worktrees/rv-noop-write\nbranch=feat/rv-noop-write\nstatus=killed\ntmuxName=review-rv-noop-write\nprAutoDetect=off\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-noop-write\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-noop-write","listSessions":"review-rv-helper-completed|2335449|2335485\nreview-rv-noop-write|2335449|2335735\nreview-rv-public-claim|2335449|2335450\nreview-rv-readonly-status|2335449|2335559\n"}
LIVE_DONE [2335449,2335450,2335485,2335559,2335735]
```

## Cleanup and host-state audit

Owned persistent live processes (private tmux server/panes and integration fixtures) were recorded by exact PID: `[2316668,2316677,2316681,2316686,2316705,2316724,2318037,2318039,2335449,2335450,2335485,2335559,2335735,2382933,2382950,2382954,2382958,2382987,2383003,2385049,2385059]`. Live panes were terminated before server 2335449; no lifecycle worker was started in this round. Integration fixtures cleaned their own private sessions. No protected process/default server/model process was touched. /proc audit by scratch HOME and explicit recorded PID ledger (excluding the audit process and ancestors):

```text
ownLiveProcesses=[]
recordedPidsStillPresent=[]
```

Both private list-sessions calls report no server running on `/tmp/tmux-44402/aor2ar3-test57` and `/tmp/tmux-44402/aor2ar3-live57`. No real lifecycle worker, protected session, watcher, default server or model process was touched. No commit/push/PR/network gh or ao send.

After `ls -la --time-style=full-iso ~/.ao/bin` (identical to before; diff empty):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required final real-state check, marker 2026-10-21 17:31:18.808373981 -0400:

```bash
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor2ar3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
```

Attribution: sessions/ has mtime 17:38:31.811642384; ao-55 has mtime 17:38:31.810642412, generation=13, status=stuck. These are the external real fleet's ao-55 status-classification write and its directory rename update. The contents indicate a lifecycle classification; stat does not identify an exact writer PID. Neither is this reviewer's write: every executable review/helper/test process used fake HOME, and live AO paths were under /tmp/aor2ar3/live (hash fbd05bb17d17), not the real fleet hash 60756641ca25. Those real files were inspected only with cat/stat/grep.

Scratch root `/tmp/aor2ar3`, marker and both exact private socket paths are now absent. Cleanup validated the owned marker/path/UID and absent recorded PIDs, traversed without following symlinks, and used unlink/rmdir. Reproducer code and evidence remain in this review. The prior two review files are unchanged; no production diff or commit.
