# Same-ID R2a round-4 independent re-check

**LAND-SAFE — 0 blockers, 0 majors, 1 nonblocking minor, 4 prior follow-ups.** Round 4 `c045f31b..26368d76`, whole R2a `cbfbc182..26368d76`. Unchanged source retains previous review results. No production edits, commits, push or PR. Author report unread until independent item 1.

Created `/tmp/aor2ar4-marker` before work. All node/pnpm/helper/test/live processes use env -i, fake HOME=/tmp/aor2ar4/home, scratch PATH=/tmp/aor2ar4/bin:/usr/bin:/bin, TMPDIR=/tmp/aor2ar4/tmp. Tests have no inherited AO variables or agent binaries. gh stub permits only version/auth status. tmux shim always unsets TMUX and forces private server aor2ar4-test57, with /dev/null config. Live uses its own private server and only scratch AO paths. No real AO commands or writes to real AO state; no model process. Protected processes are untouched; owned private PIDs will be recorded and cleaned exactly.

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

## Independent source check

The deletion predicate adds exactly pr/status/branch from the reserved snapshot, normalized absent to empty as holdsExpected does, alongside generation and launch identity. These are the three allowed fields of the shipped helpers. The delete remains one locked compare/unlink. An identical-value helper rename should still allow clean unwind; a value changed or inserted should retain the record. The changed-record branch compares launch identity only, so a helper field mismatch at the same generation is correctly reported as a changed copy-back, not as a different launch. The shared archive-refusal tail now attributes workspace preservation to this restore, allowing a concurrent claim to change it. Unlocked read/unlink overlap and generation-preserving other-key writes remain explicit owner-accepted limits.

## Independent attacks (before author report)

Frozen install and build exited 0 before live use. The verbatim 11-case reviewer suite from the round-3 review was extracted into archived scratch source copies. At c045f31b: 7 pass, four failures (shared-pr, shared-status, shared-branch, claude-pr), all completed helper writes deleted. At 26368d76: all 11 pass. A further 16 reviewer cases (eight modes each under unknown and other-launch) pass: identical helper pr/status/branch, hook pr+status together, missing pr insertion, missing branch insertion, no-change cleanup, active-record helper change. Same-value and no-change cases remove the copy-back; changed/inserted keys stay exactly as the helper left them, without a generation/reservation change. Archive and workspace stay, runtime.create is never called. The active-record case also confirms the still-broad refusal wording; assessed below.

Commands, all under the clean environment above, from scratch packages/core:

```text
node node_modules/vitest/vitest.mjs run --config review.config.ts src/__tests__/review-r3.test.ts --reporter=json --outputFile=<base-or-tip-result>
node node_modules/vitest/vitest.mjs run --config review.config.ts src/__tests__/review-r4.test.ts --reporter=json --outputFile=<edge-result>
```

Live built-code fixture: public core session manager, real built tmux/codex/worktree plugins, a scratch git repository and managed worktree, a private tmux sleep pane, scratch config/state only. Runtime.stop is controlled unknown; no agent launches. During the awaited stop, a real /usr/bin/git switch creates the new branch and the exported shipped helper writes pr/status/branch before returning. The first two harness attempts stopped on overly short diagnostic regexes (they omitted “of this restore”), after preservation/cleanup assertions passed; this was a reviewer assertion error, not a product failure. Each attempt cleaned its exact private pane/server PIDs in finally; the completed rerun uses a fresh scratch directory.

The completed live rerun exits 0 (`LIVE PASS`). Archived helper case retains generation 2, its reservation ID and all three helper values: PR 100, status pr_open, branch feat/helper-helper-completed, matching the real checkout. Archive hash/floor (1) and pane are unchanged. Identical-value helper rename cleans the active copy-back to null, raises only its floor to 2, and leaves archive/worktree/panes unchanged. Active-record case retains the helper values at generation 1, but its diagnostic still says the record and workspace are as they were. Full snapshots and the reproducible harness appear below.

## Finding and scope judgment

**m-1 — nonblocking, in-scope diagnostic overstatement.** `packages/core/src/session-manager.ts:4443`, active-record refusal. Under the whole-range rule this is in scope: `git blame` attributes the text to R2a round-2 commit `154e0b34`, not to code predating `cbfbc182`. It is unchanged in round 4, but cannot be classified as an older defect just because this round did not edit the line. Reproducer: restore an active killed record with an existing scratch worktree; during the awaited stop perform a real checkout and completed helper pr/status/branch writes; return unknown. The live record and worktree are now changed, correctly retained, yet the refusal says `nothing was restored: the record and the workspace are as they were, and no new runtime was created`. Both source refusal outcomes reproduce it. Prefer `this restore did not change the record or the workspace, and no new runtime was created`. The safety behavior is correct and the changed values remain visible; this inaccurate attribution is minor and does not block landing. It is separate from the fixed M-1 data loss.

Read the author report only after completing independent item 1. Its section 6 item 3 is the same active-record wording issue. My judgment is in-scope m-1 above, suitable for a small subsequent wording correction, not an older-defect exemption. Author evidence is corroboration, not the basis of the runs here.

## Mutants

Archived scratch tip, source aliases ensure both the core tests and the Claude hook test resolve the mutated core source. Baseline restored in finally. No worktree source was changed. Command in each scratch package: `node node_modules/vitest/vitest.mjs run --config review.config.ts <files> --reporter=json --outputFile=<result>`. Core files: runtime-stop.test.ts and runtime-stop-callers.test.ts (115 tests); Claude file: restore-copy-back-hook.test.ts (1 test).

| Predicate | Core pass/fail | Hook pass/fail | Failing test(s) |
| --- | --- | --- | --- |
| Control | 115/0 | 1/0 | none |
| Remove pr | 114/1 | 0/1 | `review attack: shared-pr`; `review attack: claude-pr` |
| Remove status | 114/1 | 1/0 | `review attack: shared-status` |
| Remove branch | 114/1 | 1/0 | `review attack: shared-branch` |
| Unconditional delete | 108/7 | 0/1 | all four helper/hook attacks, plus the four titles below |

Additional unconditional-delete failures:
- `a refusal never removes a record or a workspace that replaced the copy-back during the stop`
- `review: refused copy-back must preserve another operation metadata update`
- `review: a successful public PR claim survives another restore refusal`
- `a status write during the stop (the lifecycle poll's write) keeps the copy-back, and the refusal names the change, the kept record and the next action`

Each removed comparison is covered independently; the unconditional mutant also retains the older replacement and Node-writer tests' ability to detect loss.

## Changed text and scope

The comment at session-manager.ts:1557 and its step-7 comment at :4424 now describe value comparison, distinguish reservation from operation ownership, and name the fields and accepted limits. The shared archive-refusal tail at :1578 accurately attributes workspace preservation to this restore. DEVELOPMENT.md:458 names identity, generation, pr/status/branch and the unlocked/other-key limits; its final helper sentence correctly adds releaseCopyBack. The changed runtime paragraph at :460 explicitly qualifies the values and links to those limits. Its later “wrote to” example should be read with that explicit condition: identical helper values may be removed, as verified. It no longer establishes an “any write” guarantee for this release. Node no-op updates still increment generation and stay; helper no-op values need not stay. No demand for locking bash writers or closing the accepted read/unlink race is added by this review.

Only the four brief-listed files differ: docs/DEVELOPMENT.md; core/src/session-manager.ts; core/src/__tests__/runtime-stop-callers.test.ts; new plugins/agent-claude-code/src/__tests__/restore-copy-back-hook.test.ts. Diff is +330 -19. The hook test uses the public core package and its own fixture; the helper/hook tests wait for actual bash completion and assert changed value, stable generation/reservation, retained record/archive/workspace, no create, and accurate refusal. No wider behavioral scope change.

Commits are conventional fix(core)/docs(core), with WHY bodies explaining completed-write loss, the three comparisons and wording boundaries. No issue numbers, emoji or Co-Authored-By trailers. Parent chain is exactly c045f31b -> cc021120 -> 26368d76, no merge. `/usr/bin/git branch -r --contains 26368d76` prints nothing. No push or PR was performed.

## Gates (independent worktree runs)

Each command ran with env -i HOME=/tmp/aor2ar4/home PATH=/tmp/aor2ar4/bin:/usr/bin:/bin TMPDIR=/tmp/aor2ar4/tmp CI=1. Install also used HUSKY=0. Build preceded live execution. The seven filters ran together via pnpm --filter; the full test command ran once, after those filters completed.

```text
pnpm install --frozen-lockfile: exit 0
pnpm build: exit 0, 12 packages build: Done
pnpm typecheck: exit 0, 13 packages typecheck: Done
pnpm lint: exit 0, 5 problems (0 errors, 5 warnings)

Requested test filters (exit 0):
packages/core test:  Test Files  57 passed (57)
packages/core test:       Tests  1548 passed | 11 expected fail (1559)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/workspace-worktree test:  Test Files  4 passed (4)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)

pnpm -r --no-bail test (exit 0):
packages/core test:  Test Files  57 passed (57)
packages/core test:       Tests  1548 passed | 11 expected fail (1559)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  220 passed (220)
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
packages/plugins/workspace-worktree test:  Test Files  4 passed (4)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

Lint warnings are the prior spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232 non-null assertions and session-manager.ts:2335,2342 console statements. Integration has 24 skipped tests (agent/live binary-dependent blocks); real model and Herdr processes were not run. The gh stub only allows --version and auth status.

SAME_ID_DEFECTS=red: every same-id-defects and same-id-reuse-window file in core, CLI, four agent packages, two runtime packages and worktree ran against archived c045f31b and 26368d76 with source aliases.

| Round | c045f31b fail/pass | 26368d76 fail/pass |
| --- | --- | --- |
| R1 | 0/17 | 0/17 |
| R2 | 16/20 | 16/20 |
| R3 | 6/0 | 6/0 |
| R4 | 22/11 | 22/11 |

44 intentional red failures at each revision; per-test name/status diff is `[]`. Normal mode keeps these as expected defects; no new red failures.

## Verdict for the whole R2a range

**LAND-SAFE — 0 blockers, 0 majors, 1 nonblocking minor, 4 prior follow-ups.** No finding blocks landing of `cbfbc182..26368d76` under the stated rule. The round-3 M-1 is fixed within the owner's bounded scope: a shipped helper/hook's completed change of pr/status/branch before the locked read is preserved and accurately reported. The three accepted limits (unlocked read/unlink overlap, bash writers without the Node lock, other-key writes preserving generation) stay limits, not reopened requirements.

m-1 is the active-record refusal's attribution, introduced in R2a and therefore in scope, but nonblocking because the record, worktree and live pane are preserved. No new B-n or M-n. Prior round-1 workspace ordering and round-2 exception/CLI fixes remain valid; round-3 Node/public-claim preservation and reservation wording remain valid. This re-check does not claim to fix the older red defects.

Prior follow-ups, unchanged:

1. **F-1:** older kill skip guards for missing/malformed runtime identity or unloaded plugin.
2. **F-2:** recovery's pre-existing runtimeAlive=false trust; a validator probe rejection already selects skip.
3. **F-3:** remaining send.ts refusal presentation belongs to ao-54; other round-2 CLI diagnostics remain fixed.
4. **F-4:** older operation/workspace serialization, including a second restore entering through the active copy-back. The corrected comments describe a reservation, not an operation lock.

Correct parts: field comparison uses the reserved snapshot and absent-as-empty normalization; all checks and unlink stay in one locked delete; changed helper values keep the active record and accurate archive-refusal guidance; same-value helpers and read-only listing retain clean unwind; Node no-op updates remain protected by generation; replacements and gone records keep their distinct handling; tests fail when each comparison is removed; exact four-file scope and linear local commits hold.

## Retained reproducer evidence

The original 11-case source is unchanged from the code fence in `same_id_r2a_review_r3_astra6.md`. The following additional source and live harness are retained because the scratch tree is removed at completion. Test assertions of old active-refusal wording document m-1, not an endorsement of that text.

### Additional source attacks

```ts
import {it,expect,vi} from 'vitest';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {setupTestContext,teardownTestContext,makeHandle} from './test-utils.js';
import {createSessionManager} from '../session-manager.js';
import {writeMetadata,readMetadataRaw,readArchivedMetadataRaw,deleteMetadata} from '../metadata.js';
import {getWorktreesDir} from '../paths.js';
import {AO_METADATA_HELPER} from '../agent-workspace-hooks.js';
import {METADATA_UPDATER_SCRIPT} from '../../../plugins/agent-claude-code/src/index.js';
const modes=['same-pr','same-status','same-branch','hook-both','missing-pr','missing-branch','no-change','active-changed'] as const;
for(const outcome of ['unknown','other-launch'] as const)for(const mode of modes)it(`${mode} / ${outcome}`,async()=>{
 const c=setupTestContext();try{
 const id='app-1',wt=join(getWorktreesDir(c.config.configPath,c.config.projects['my-app']!.path),id);mkdirSync(wt,{recursive:true});
 c.mockAgent.getActivityState=vi.fn().mockResolvedValue({state:'exited'});c.mockAgent.isProcessRunning=vi.fn().mockResolvedValue(false);
 const raw:Record<string,string>={project:'my-app',worktree:wt,status:mode==='same-status'?'pr_open':'killed',runtimeHandle:JSON.stringify(makeHandle('rt-old'))};
 if(mode!=='missing-branch')raw.branch='feat/original';if(mode==='same-pr')raw.pr='https://github.com/review/scratch/pull/99';
 writeMetadata(c.sessionsDir,id,raw);if(mode!=='active-changed')deleteMetadata(c.sessionsDir,id,true);
 const archive=readArchivedMetadataRaw(c.sessionsDir,id),sm=createSessionManager({config:c.config,registry:c.mockRegistry});
 let before:Record<string,string>|null=null,written:Record<string,string>|null=null;
 c.mockRuntime.stop=vi.fn(async()=>{
 before=readMetadataRaw(c.sessionsDir,id);const helper=join(c.tmpDir,'helper.sh');writeFileSync(helper,AO_METADATA_HELPER);
 const env={...process.env,AO_DATA_DIR:c.sessionsDir,AO_SESSION:id};
 if(mode==='hook-both'){
 const fns=['hook_is_safe_branch','hook_is_safe_pr','update_metadata_key'].map(n=>{const m=METADATA_UPDATER_SCRIPT.match(new RegExp('^'+n+'\\(\\) \\{[\\s\\S]*?^\\}','m'));if(!m)throw Error(n);return m[0];}).join('\n');
 const hook=join(c.tmpDir,'hook.sh');writeFileSync(hook,fns);execFileSync('/bin/bash',['--noprofile','--norc','-c','metadata_file="$AO_DATA_DIR/$AO_SESSION"; source "$1"; update_metadata_key pr "$2"; update_metadata_key status pr_open','review',hook,'https://github.com/review/scratch/pull/100'],{env});
 }else if(mode!=='no-change'){
 const key=mode==='active-changed'?'branch':mode.replace(/^(same|missing)-/,'');const value=mode.startsWith('same-')?before![key]!:key==='pr'?'https://github.com/review/scratch/pull/100':'feat/helper';
 execFileSync('/bin/bash',['--noprofile','--norc','-c','source "$1"; update_ao_metadata "$2" "$3"','review',helper,key,value],{env});
 }
 written=readMetadataRaw(c.sessionsDir,id);expect(written?.generation).toBe(before?.generation);expect(written?.reservationId).toBe(before?.reservationId);
 if(mode.startsWith('same-')||mode==='no-change')expect(written).toEqual(before);else expect(written).not.toEqual(before);
 return {outcome,detail:'controlled refusal'};
 });
 const err=await sm.restore(id).catch((e:unknown)=>e),after=readMetadataRaw(c.sessionsDir,id);expect((err as Error).message).toContain('runtime stop unconfirmed');expect(c.mockRuntime.stop).toHaveBeenCalledOnce();expect(c.mockRuntime.create).not.toHaveBeenCalled();
 const clean=mode.startsWith('same-')||mode==='no-change';expect(after).toEqual(clean?null:written);expect(readArchivedMetadataRaw(c.sessionsDir,id)).toEqual(archive);expect(existsSync(wt)).toBe(true);
 if(mode==='active-changed')expect((err as Error).message).toContain('the record and the workspace are as they were');else {expect((err as Error).message).toContain('this restore did not change the workspace');expect((err as Error).message).toContain(clean?'removed':'changed');}
 console.log(JSON.stringify({mode,outcome,before,written,after,message:(err as Error).message}));
 }finally{teardownTestContext(c);}
});
```

### Live built-code harness

```js
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor2ar4/live-v3',label='aor2ar4-live57',clean={...process.env};
for(const key of Object.keys(clean))assert(!key.startsWith('AO_'));assert.equal(clean.HOME,'/tmp/aor2ar4/home');
mkdirSync(dir+'/repo',{recursive:true});mkdirSync(dir+'/bin',{recursive:true});
const git=(cwd,...args)=>execFileSync('/usr/bin/git',args,{cwd,env:clean,encoding:'utf8'}).trim();
const tmux=(...args)=>execFileSync('/usr/bin/env',['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L',label,...args],{env:clean,encoding:'utf8'}).trim();
writeFileSync(dir+'/bin/tmux','#!/bin/sh\nexec env -u TMUX /usr/bin/tmux -f /dev/null -L '+label+' "$@"\n',{mode:0o755});
git(dir+'/repo','init','-b','main');git(dir+'/repo','config','user.email','review@example.invalid');git(dir+'/repo','config','user.name','Scratch Review');writeFileSync(dir+'/repo/README','scratch\n');git(dir+'/repo','add','README');git(dir+'/repo','commit','-m','test: seed isolated checkout');
process.env.PATH=dir+'/bin:'+clean.PATH;process.env.AO_STATE_ROOT=dir+'/state';process.env.AO_CONFIG_PATH=dir+'/config.yaml';
writeFileSync(process.env.AO_CONFIG_PATH,JSON.stringify({defaults:{runtime:'tmux',agent:'codex',workspace:'worktree',notifiers:[]},projects:{review:{path:dir+'/repo',repo:'review/scratch',sessionPrefix:'rv',defaultBranch:'main'}}}));
const core=await import(root+'/packages/core/dist/index.js'),metadata=await import(root+'/packages/core/dist/metadata.js'),paths=await import(root+'/packages/core/dist/paths.js');
const {AO_METADATA_HELPER}=await import(root+'/packages/core/dist/agent-workspace-hooks.js');writeFileSync(dir+'/helper.sh',AO_METADATA_HELPER);
const config=core.loadConfig(),registry=core.createPluginRegistry();for(const p of ['runtime-tmux','agent-codex','workspace-worktree'])registry.register((await import(root+'/packages/plugins/'+p+'/dist/index.js')).default);
const sessions=paths.getSessionsDir(config.configPath,dir+'/repo'),wtroot=paths.getWorktreesDir(config.configPath,dir+'/repo');mkdirSync(wtroot,{recursive:true});mkdirSync(sessions,{recursive:true});
const runtime=registry.get('runtime','tmux'),sm=core.createSessionManager({config,registry}),panes=[];let server;
const snap=(id,wt)=>({active:core.readMetadataRaw(sessions,id),archive:existsSync(sessions+'/archive')?readdirSync(sessions+'/archive').filter(n=>n.startsWith(id+'_')).map(n=>({name:n,sha256:createHash('sha256').update(readFileSync(sessions+'/archive/'+n)).digest('hex')})):[],floor:existsSync(sessions+'/.generations/'+id)?readFileSync(sessions+'/.generations/'+id,'utf8').trim():null,workspace:readdirSync(wt),branch:git(wt,'branch','--show-current'),panes:tmux('list-panes','-a','-F','#{session_name}|#{pid}|#{pane_pid}')});
try{
for(const mode of ['helper-completed','same-value','active-changed']){
 const id='rv-'+mode,wt=wtroot+'/'+id,name='review-'+id;git(dir+'/repo','worktree','add','-b','feat/'+id,wt);
 tmux('new-session','-d','-s',name,'-c',wt,'exec /bin/sleep 600');const [s,p]=tmux('list-panes','-t',name,'-F','#{pid} #{pane_pid}').split(' ').map(Number);server=s;panes.push(p);appendFileSync(dir+'/pids',s+' '+p+'\n');
 core.writeMetadata(sessions,id,{project:'review',agent:'codex',worktree:wt,branch:'feat/'+id,status:'killed',tmuxName:name,prAutoDetect:'off',createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id:name,runtimeName:'tmux',data:{}})});
 if(mode!=='active-changed')core.deleteMetadata(sessions,id,true);
 const before=snap(id,wt);let during;console.log('BEFORE',mode,JSON.stringify(before));
 runtime.stop=async()=>{
  if(mode!=='same-value')git(wt,'switch','-c','feat/helper-'+mode);
  const script=mode==='same-value'?'source "$1"; update_ao_metadata branch "$2"':'source "$1"; update_ao_metadata pr https://github.com/review/scratch/pull/100; update_ao_metadata status pr_open; update_ao_metadata branch "$2"';
  execFileSync('/bin/bash',['--noprofile','--norc','-c',script,'review',dir+'/helper.sh',mode==='same-value'?'feat/'+id:'feat/helper-'+mode],{env:{...clean,AO_STATE_ROOT:dir+'/state',AO_DATA_DIR:sessions,AO_SESSION:id}});
  during=snap(id,wt);console.log('DURING',mode,JSON.stringify(during));return {outcome:'unknown',detail:'review controlled refusal; original pane left running'};
 };
 const err=await sm.restore(id).catch(e=>e);assert(err instanceof Error);console.log('ERROR',mode,err.message);const after=snap(id,wt);console.log('AFTER',mode,JSON.stringify(after));
 assert.match(err.message,/runtime stop unconfirmed/);assert.deepEqual(after.archive,before.archive);assert.equal(after.panes,before.panes);assert.deepEqual(after.workspace,before.workspace);
 if(mode==='same-value'){assert.equal(after.active,null);assert.match(err.message,/copy-back of this restore was removed/);}else{assert.deepEqual(after.active,during.active);assert.equal(after.active.pr,'https://github.com/review/scratch/pull/100');assert.equal(after.active.status,'pr_open');assert.equal(after.active.branch,after.branch);}
 if(mode==='helper-completed'){assert.equal(after.active.generation,'2');assert.match(err.message,/copy-back of this restore changed during the stop/);assert.match(err.message,/this restore did not change the workspace/);}
 if(mode==='active-changed')assert.match(err.message,/the record and the workspace are as they were/);
}
console.log('LIVE PASS');
}finally{for(const pid of panes)try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}if(server)try{process.kill(server,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
```

### Live built-code snapshots

```text
Preparing worktree (new branch 'feat/rv-helper-completed')
BEFORE helper-completed {"active":null,"archive":[{"name":"rv-helper-completed_2026-10-22T01-26-12-135Z","sha256":"7c5e11bc7fbb47970f18f0b535773a928b7b457cb4a99e8c8258e263281a5faf"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-helper-completed","panes":"review-rv-helper-completed|356149|356153"}
Switched to a new branch 'feat/helper-helper-completed'
DURING helper-completed {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-helper-completed","branch":"feat/helper-helper-completed","status":"pr_open","tmuxName":"review-rv-helper-completed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"c061cffa-33cf-4980-88b6-2aabba1bfc45","generation":"2","pr":"https://github.com/review/scratch/pull/100"},"archive":[{"name":"rv-helper-completed_2026-10-22T01-26-12-135Z","sha256":"7c5e11bc7fbb47970f18f0b535773a928b7b457cb4a99e8c8258e263281a5faf"}],"floor":"1","workspace":[".git","README"],"branch":"feat/helper-helper-completed","panes":"review-rv-helper-completed|356149|356153"}
ERROR helper-completed runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of rv-helper-completed with that write and was not removed; this restore did not change the workspace, and no new runtime was created; check that record with `ao session ls` before you restore again, because a restore now reads the active record and not the archive
AFTER helper-completed {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-helper-completed","branch":"feat/helper-helper-completed","status":"pr_open","tmuxName":"review-rv-helper-completed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-helper-completed\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"c061cffa-33cf-4980-88b6-2aabba1bfc45","generation":"2","pr":"https://github.com/review/scratch/pull/100"},"archive":[{"name":"rv-helper-completed_2026-10-22T01-26-12-135Z","sha256":"7c5e11bc7fbb47970f18f0b535773a928b7b457cb4a99e8c8258e263281a5faf"}],"floor":"1","workspace":[".git","README"],"branch":"feat/helper-helper-completed","panes":"review-rv-helper-completed|356149|356153"}
Preparing worktree (new branch 'feat/rv-same-value')
BEFORE same-value {"active":null,"archive":[{"name":"rv-same-value_2026-10-22T01-26-12-371Z","sha256":"f529515e2b46793d9d15728d3ecd28addbef3723a7a7aec17c91ff1b74a0f8b0"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-same-value","panes":"review-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
DURING same-value {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-same-value","branch":"feat/rv-same-value","status":"killed","tmuxName":"review-rv-same-value","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-same-value\",\"runtimeName\":\"tmux\",\"data\":{}}","reservationId":"aba58c3e-50a2-4673-975b-12cdc6e49342","generation":"2"},"archive":[{"name":"rv-same-value_2026-10-22T01-26-12-371Z","sha256":"f529515e2b46793d9d15728d3ecd28addbef3723a7a7aec17c91ff1b74a0f8b0"}],"floor":"1","workspace":[".git","README"],"branch":"feat/rv-same-value","panes":"review-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
ERROR same-value runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; nothing was restored: the archive copy-back of this restore was removed again, this restore did not change the workspace, and no new runtime was created
AFTER same-value {"active":null,"archive":[{"name":"rv-same-value_2026-10-22T01-26-12-371Z","sha256":"f529515e2b46793d9d15728d3ecd28addbef3723a7a7aec17c91ff1b74a0f8b0"}],"floor":"2","workspace":[".git","README"],"branch":"feat/rv-same-value","panes":"review-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
Preparing worktree (new branch 'feat/rv-active-changed')
BEFORE active-changed {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-active-changed","branch":"feat/rv-active-changed","status":"killed","tmuxName":"review-rv-active-changed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-active-changed\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1"},"archive":[],"floor":null,"workspace":[".git","README"],"branch":"feat/rv-active-changed","panes":"review-rv-active-changed|356149|356288\nreview-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
Switched to a new branch 'feat/helper-active-changed'
DURING active-changed {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-active-changed","branch":"feat/helper-active-changed","status":"pr_open","tmuxName":"review-rv-active-changed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-active-changed\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1","pr":"https://github.com/review/scratch/pull/100"},"archive":[],"floor":null,"workspace":[".git","README"],"branch":"feat/helper-active-changed","panes":"review-rv-active-changed|356149|356288\nreview-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
ERROR active-changed runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; nothing was restored: the record and the workspace are as they were, and no new runtime was created
AFTER active-changed {"active":{"worktree":"/tmp/aor2ar4/live-v3/state/c5836b9c1f4f-repo/worktrees/rv-active-changed","branch":"feat/helper-active-changed","status":"pr_open","tmuxName":"review-rv-active-changed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"review-rv-active-changed\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1","pr":"https://github.com/review/scratch/pull/100"},"archive":[],"floor":null,"workspace":[".git","README"],"branch":"feat/helper-active-changed","panes":"review-rv-active-changed|356149|356288\nreview-rv-helper-completed|356149|356153\nreview-rv-same-value|356149|356232"}
LIVE PASS
```

## Cleanup evidence

All 25 recorded private tmux server/pane PIDs are gone. Live fixtures stopped exact pane PIDs before exact server PIDs in finally, including failed harness attempts; integration fixtures cleaned their private sessions. No lifecycle worker was started. No protected worker/session/watcher or default server was touched. /proc audit by scratch HOME/AO_STATE_ROOT, excluding the audit process and its ancestors, and exact PID ledger:

```json
{
  "recordedPids": [
    313065,
    313079,
    313083,
    313087,
    313109,
    313128,
    313850,
    313851,
    316614,
    316615,
    327423,
    327424,
    327521,
    356149,
    356153,
    356232,
    356288,
    363859,
    363870,
    363876,
    363884,
    363912,
    363941,
    365266,
    365272
  ],
  "ownLiveProcesses": [],
  "recordedPidsStillPresent": []
}
```

Both private checks (`env -u TMUX /usr/bin/tmux -f /dev/null -L aor2ar4-test57|aor2ar4-live57 list-sessions`, each with the clean env) answer no server running at their exact sockets in /tmp/tmux-44402. No own processes remain.

After `ls -la --time-style=full-iso ~/.ao/bin` (diff against before prints nothing):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state check, every entry quoted:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor2ar4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
```

Read-only attribution evidence (stat/grep only):

```text
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
  Size: 4096      	Blocks: 8          IO Block: 4096   directory
Device: 259,5	Inode: 72486286    Links: 4
Access: (0755/drwxr-xr-x)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 21:27:37.071346442 -0400
Modify: 2026-10-21 21:27:08.096264018 -0400
Change: 2026-10-21 21:27:08.096264018 -0400
 Birth: 2026-10-14 12:14:17.283172845 -0400
  File: /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
  Size: 676       	Blocks: 8          IO Block: 4096   regular file
Device: 259,5	Inode: 72510800    Links: 1
Access: (0644/-rw-r--r--)  Uid: (44402/ taisung)   Gid: (  100/   users)
Access: 2026-10-21 21:27:37.071346442 -0400
Modify: 2026-10-21 21:27:08.096264018 -0400
Change: 2026-10-21 21:27:08.096264018 -0400
 Birth: 2026-10-21 21:27:08.096264018 -0400
generation=23
status=stuck
project=agent-orchestrator
agent=claude-code
```

These are the external real fleet's ao-55 stuck-status write and its directory rename update. The record fields and timing support a lifecycle classification; stat does not identify an exact writer PID. Every executable reviewer test/helper/live process used fake HOME, and all live AO paths were under /tmp/aor2ar4 (final live hash c5836b9c1f4f), never real fleet 60756641ca25. No real AO command/state write, network gh, model turn, stash, real-repository worktree operation, commit, push, PR or ao send. Real ~/.ao/bin is unchanged. Tracked worktree diff is empty, HEAD remains 26368d76; prior review files stay in place.

Final cleanup: scratch root `/tmp/aor2ar4`, marker `/tmp/aor2ar4-marker`, and exact owned private socket files removed after the final empty-process audit. Recursive removal checked ownership and did not follow symlinks. Absence verified. Review and report are the only new deliverables; no tracked code changed.
