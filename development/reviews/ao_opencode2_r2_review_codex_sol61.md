NOT-LAND-SAFE

Round 2, b90ac08f..6d204435, judged with the complete landing 273b62c1..6d204435: **1 blocker, 1 major, 1 minor**. New IDs continue round 1: B-1, M-2, m-2. The original nonzero-create M-1 reproducer and the original m-1 failures are fixed. The blocker is a settings-invariant failure under deliberate server-mapping simulation; ordinary 2.0.29 requests preserved the settings tested. That distinction is part of the finding, not an assertion that 2.0.29 naturally maps these agent names.

## Findings

### B-1 — Successful creation with a valid ID bypasses the settings check

**File/line:** packages/plugins/agent-opencode/src/index.ts:132, :174, :482, :483.

The capture script extracts only data.id. Settings verification is inside the empty-SES_ID branch, so it never runs when creation returns a usable ID. A response/session with an agent or model different from the request is then accepted, and the TUI receives the task prompt. This contradicts the brief's explicit acceptance condition: a TUI on settings different from the request is a blocker.

**Independent evidence:**

~~~text
node /tmp/ao2r2-review-PbjHP4/matrix.mjs
fresh-create-mapped-agent:
  request: opencode-go/muse-spark-1.3-contributor#xhigh, plan
  stored:  opencode-go/muse-spark-1.3-contributor#xhigh, build
  operations: session.create; TUI ses_created
  status: 0; stderr: empty; no readback
fresh-create-mapped-model:
  stored: opencode/big-pickle#default, plan
  status: 0; TUI ses_created; no readback
~~~

The independent fake accepts the generated request unchanged, deliberately stores mapped settings, and returns a valid ID plus those differing stored settings. Thus even information already present in the create response is discarded. The appendix's mapped-create case reproduces the agent mismatch without a real OpenCode service.

The equivalent controlled live case (python3 /tmp/ao2r2-review-PbjHP4/live-matrix.py) forwarded a simulated agent mapping to the real isolated server, intercepted the TUI, and read the resulting session back:

~~~text
fresh-simulated-mapped-agent
generated request agent: plan
TUI session: ses_ec316fc87ffeZhwrEhxPOZn511
real session.get: agent=build, model=opencode-go/muse-spark-1.3-contributor#xhigh
operations: session.create only
status: 0; stderr: empty; zero tokens
~~~

**Limit:** the live wrapper changed the forwarded agent to simulate a mapping; this was not natural normalization by 2.0.29. Separate direct create/switch tests preserved all nine agent names tested (plan, build, general, explore, Build, code, default, primary, repo/name). The real binary's ordinary create path passed. The blocker classification follows the requested settings invariant under the explicit mapping fault, rather than claiming an observed native alias bug.

**Required change:** validate requested settings on the successful-ID path too, using returned session data or a successful session.get, and stop on a difference. Add a fresh-create test where the service returns a valid ID but stores/maps a different requested setting. The current fake always copies create settings, so its new success test cannot catch this.

### M-2 — An unusable ID still permits silently resuming another task's conversation

**File/line:** packages/plugins/agent-opencode/src/index.ts:470, :475, :482; index.test.ts:1608 intentionally accepts the older session.

Exit 0 is not evidence that the title match belongs to this create. The source itself recognizes that the selected session may be older. Switching and checking model/agent changes two fields; it does not identify the newly created conversation or clear earlier task history. The command then submits the new task prompt to that older conversation. With multiple matches, newest updated can identify an older conversation that was recently active, rather than the session created by this invocation.

This is the same conversation-identity problem that the author correctly cites as the reason to reject title recovery after a nonzero create. A successful invocation could have created a session, but that possibility does not establish which matching ID is its result. The title fallback should also stop when creation succeeds without an identifiable ID, unless there is independent proof that the selected session was created by this invocation.

**Independent evidence:**

~~~text
python3 /tmp/ao2r2-review-PbjHP4/live-matrix.py
zero-noop: wrapper returns 0/no output and makes no new session
  opens pre-existing seed ses_ec3174a8bffer4FkG2Nb94wzYE
  stored model/agent after switches: requested Muse Spark#xhigh / plan
  operations: create, list, switchModel, switchAgent, get, TUI
  status: 0; stderr: one empty line
zero-malformed-noop: returns 0 and {"data":{"id":"bad id"}}, makes no session
  opens pre-existing seed ses_ec31743c4ffegowlKcCO7L0CPH
  requested settings pass readback; status 0
zero-several-matches: no new session
  opens the newer pre-existing seed ses_ec3172f4affeUhFfcQhpIXfrHI
  requested settings pass readback; status 0
~~~

These are intentional CLI-output faults, with real list/switch/get operations against isolated stored sessions. The independent fake additionally seeded conversationMarker=ANOTHER_TASK; it survived every switch and was present in the session opened by the TUI. The appendix's older-conversation case prints that unchanged marker alongside the new task prompt and matching settings. I did not claim that the live seeds contained model-generated history; no model turn was run.

**Required change:** stop the 2.x new-session path when the successful create response lacks a valid ID, or require evidence tying the selected ID to this invocation. Retain the required legacy branch separately. A settings readback alone is insufficient. Update the tests that currently require opening an explicitly older session.

### m-2 — The readback pipeline ignores the CLI's nonzero exit status

**File/line:** packages/plugins/agent-opencode/src/index.ts:296.

The session.get-to-node pipeline returns the checker's status. If session.get emits matching JSON but exits nonzero, the checker exits 0 and the TUI opens. This affects the fallback, resume, and restore through the shared settings function. It is a new failure introduced by the readback addition, separate from the original echo status problem.

**Independent evidence:**

~~~text
node /tmp/ao2r2-review-PbjHP4/matrix.mjs
resume-get-failed-with-valid-data / restore-get-failed-with-valid-data:
  get stdout: valid matching {"data": ...}
  get stderr: readback transport failure after body
  get exit: 1
  generated command exit: 0; TUI opens ses_old
~~~

The controlled live case performed a real successful session.get, then deliberately returned its valid stdout with exit 1:

~~~text
python3 /tmp/ao2r2-review-PbjHP4/live-matrix.py
resume-nonzero-get-valid-body / restore-nonzero-get-valid-body:
  stderr: injected readback failure after valid JSON
  generated command status: 0
  TUI opens ses_ec31729c6ffe9P4jS7HmiXuEj2
~~~

The appendix's failed-readback case reproduces this. Real HTTP 404 and fake HTTP 500 readbacks containing the normal error document correctly stop with status 1; they do not exercise the discarded-status case. I have not observed unmodified 2.0.29 naturally emitting matching success data with a nonzero status, so this is a minor robustness failure, not an assertion that ordinary HTTP errors bypass the check.

**Required change:** capture and check session.get's exit status before comparing its output, just as the new create code does. Add a matching-output/nonzero-status test.

## Closure of round-1 findings and failure matrix

Commands: the original python3 /tmp/ao2-review-QiticP/reproduce-failures.py against the new build; node /tmp/ao2r2-review-PbjHP4/matrix.mjs; and python3 /tmp/ao2r2-review-PbjHP4/live-matrix.py. TUI invocations were intercepted, so “opens” below means the generated command reached the TUI invocation on that ID. Stored settings were read from the real isolated service whenever a TUI invocation occurred.

**M-1's original nonzero-create reproduction is closed:** a real HTTP 400 from {"model":123} prints the response and failed-to-create message, exits 1, calls no title lookup and no TUI, and leaves the older seed unchanged. Synthetic HTTP 500/nonzero failures also stop before lookup for all four model/agent-presence combinations.

**m-1's original cases are closed:** the original appendix now returns 1 for fresh, resume, and invalid, with no TUI. Normal switch failures and providerless models also return 1. m-2 concerns a different readback pipeline added in this round.

For the following table, the explicit request is opencode-go/muse-spark-1.3-contributor#xhigh and plan:

| New-session case | Pane stderr | Selected session and readback | Status |
|---|---|---|---:|
| Create exits nonzero / real HTTP 400 | HTTP error, response JSON, create-failure message | No lookup, no TUI; older seed unchanged | 1 |
| Create exits nonzero / fake HTTP 500 | HTTP error, response JSON, create-failure message | No lookup or TUI | 1 |
| Exit 0, empty response, no session created | Empty line | Older title match; requested model/agent after switches and readback; M-2 | 0 |
| Exit 0, malformed ID, no session created | Unusable response JSON | Older title match; requested model/agent; M-2 | 0 |
| Exit 0, real create succeeds, response suppressed | Empty line | Actual newly created session; requested model/agent | 0 |
| Exit 0, real create succeeds, response ID replaced with malformed ID | Unusable response JSON | Actual newly created session recovered by title; requested model/agent | 0 |
| Exit 0/no ID, no title match | Empty line and discover-ID error | No TUI | 1 |
| Exit 0/no ID, several title matches | Empty line | Newest pre-existing title match; requested model/agent; M-2 | 0 |
| Fallback model switch fails | HTTP error and settings-failure message | No TUI | 1 |
| Fallback agent switch fails after good model switch | HTTP error and settings-failure message | Model may already be changed; no TUI | 1 |
| Fallback get fails with error document | Error response and settings-failure message | No TUI | 1 |
| Fallback readback differs / ignored agent switch | Stored values and settings-failure message | No TUI | 1 |
| Valid create ID, simulated stored agent/model mapping | None | Differing stored requested setting; B-1 | 0 |

Resume and restore standard failures were independently tested:

| Case | Resume | Restore | Pane behavior |
|---|---|---|---|
| Failed switchModel | 1, no TUI | 1, no TUI | Real HTTP 400 plus settings-failure message; fake HTTP 500 also checked |
| Failed switchAgent after successful model switch | 1, no TUI | Not applicable: restore never switches an agent | Real HTTP 400 plus settings-failure message; first switch has already run |
| Failed get with an error document | 1, no TUI | 1, no TUI | Real HTTP 404/error JSON plus settings-failure message |
| Model without provider/ | 1, no TUI, no API call | Same | Invalid-model message names the value |
| Matching get body with nonzero get exit | 0, TUI | 0, TUI | Injected error text only; m-2 |

## Readback comparison and regressions checked

- Omitted variant, explicit #default, and #xhigh succeed with the corresponding real stored variant. Omitted variants become default. A stored xhigh for an unvaried request fails the new test and the check.
- The check compares the provider ID and model ID separately. Requested CLI foo/bar/model splits to provider foo, model bar/model. An injected readback with provider foo/bar, model model is rejected with stored-values stderr, status 1, and no TUI, despite producing the same combined CLI string. Direct API calls confirm that real 2.0.29 can store provider IDs containing /. This verifies canonical-field comparison, not support for disambiguating every possible provider name in CLI text.
- When readback runs, an injected mapped agent (plan to build) is rejected with stored-values stderr, status 1, no TUI. B-1 concerns the fresh path where the check does not run. No native alias mapping was discovered in the nine direct real-binary agent cases.
- The harness ran 51 comparisons with the read-only old primary-checkout build: identical 1.x command fragments, CLI argv, stderr, and status. Seven complete command strings are identical; 44 contain the legacy command under the version wrapper. The source of the full 1.x branch is unchanged.
- The same harness and extra.mjs preserved quotes, spaces, dollar signs, backticks, command-substitution text, and embedded newlines in title, model/variant, agent, prompt, system prompt file path/content, and directory. Five existing-session prompt combinations passed through the added settings/readback code. No injection marker appeared. Invalid session IDs remain rejected.
- Successful real creation stored the requested AO title, directory, model/variant, and agent. Successful resume/restore switches and gets produced matching readbacks. Every inspected real session had zero input/output tokens and zero cost.
- Real 2.0.29 and isolated downloaded 1.18.35 --version both returned 0. Positional version returned 1/ENOENT on 2.0.29 and 0/directory error on 1.18.35. detect() remains on --version; its tests pass for both generations.

The exact version probe was re-executed:

| stdout | Parsed major | Branch | Assessment |
|---|---:|---|---|
| 1.18.35 | 1 | legacy | Correct |
| opencode v2.0.29 | 2 | API | Correct |
| 2.1.0-beta.1 | 2 | API | Correct major policy |
| 10.0.0 | 10 | API | Correct parse; future API compatibility remains assumed |
| empty | empty, defaults to 0 | legacy | Documented compatibility default, not proof of capability |
| missing binary | empty, defaults to 0 | legacy | Visible command-not-found errors and discover-ID error, exit 1, no TUI |

## Tests and required commands

All ran only in this worktree:

~~~text
pnpm install                            exit 0
  Lockfile is up to date, resolution step is skipped
  Already up to date
  . prepare: Done
  Done in 1.1s
pnpm build                              exit 0
  Scope: 14 of 15 workspace projects
  packages/plugins/agent-opencode build: Done
  packages/cli build: Done
pnpm --filter @aoagents/ao-plugin-agent-opencode test       exit 0
  Test Files  1 passed (1)
       Tests  141 passed (141)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck  exit 0
  > tsc --noEmit
pnpm lint                               exit 0
  ✖ 6 problems (0 errors, 6 warnings)
~~~

All six warnings are on unchanged statements. Full monorepo tests were optional and were not run by me; the author's full-suite totals are not my verification.

**Non-vacuity:** copied the current test file into /tmp/ao2r2-review-PbjHP4/old-tests/src/index.test.ts, put git show b90ac08f:packages/plugins/agent-opencode/src/index.ts in that scratch tree's src/index.ts, and linked the worktree package's dependencies. Ran the package's Vitest binary in that scratch directory:

~~~text
Test Files  1 failed (1)
     Tests  22 failed | 119 passed (141)
~~~

The failing names are listed below. This scratch run did not edit a tracked file.

- 2.x launch when session.create fails or returns no session ID > a failed create does not open the older session with the same title ('model and agent')
- 2.x launch when session.create fails or returns no session ID > a failed create does not open the older session with the same title ('model only')
- 2.x launch when session.create fails or returns no session ID > a failed create does not open the older session with the same title ('agent only')
- 2.x launch when session.create fails or returns no session ID > a failed create does not open the older session with the same title ('no model and no agent')
- 2.x launch when session.create fails or returns no session ID > a failed create without a session with the title stops with status 1
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens the found session only with the requested settings ('model and agent')
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens the found session only with the requested settings ('model only')
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens the found session only with the requested settings ('agent only')
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens no TUI when 'session.switchModel fails'
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens no TUI when 'session.switchAgent fails'
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens no TUI when 'session.get fails'
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens no TUI when 'session.switchModel stores nothing'
- 2.x launch when session.create fails or returns no session ID > a create without a session ID opens no TUI when 'session.switchAgent stores nothing'
- 2.x launch when session.create fails or returns no session ID > a readback with another variant than the request counts as a failure
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: stores the model and agent on the session, then opens the TUI without them
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'resume' stops with status 1 and no TUI when session.switchModel fails
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'restore' stops with status 1 and no TUI when session.switchModel fails
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: resume stops with status 1 and no TUI when the session does not exist
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: resume stops with status 1 and no TUI when session.switchAgent fails after the model switch
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: resume stops with status 1 and no TUI when the readback differs from the request
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'resume' stops with status 1 before any API call when the model has no provider
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'restore' stops with status 1 before any API call when the model has no provider

The fake now can fail session.create: failing.includes(operation) runs before creation and returns HTTP 500/nonzero. It keeps a persistent store, and the failure tests assert status plus absence of TUI, or the opened session's stored settings on the accepted missing-ID path. They are stronger than round 1 and assert input/output/state relations. Their remaining assumptions explain the new findings: successful creation always stores exactly the request; title recovery is allowed to reuse older sessions; and failed get output is always an error document. The fake's apiIgnore does not actually ignore session.create because creation returns before that check, despite the author's broader wording; create failure itself works and is tested.

The test literal fake was again compared with isolated real 2.0.29 for --version, positional version, run --command true, TUI --model, and TUI --agent. Exit statuses match (0 for --version, 1 for the others), and version stdout/flag-error identifiers match. It still omits real usage stdout and rejects --help with status 1 where the real binary returns 0. Those fidelity limits were already present and do not invalidate the tested flag paths.

## Independence, scope, and cleanup

I recorded my own view of items 1–3 in /tmp/ao2r2-review-PbjHP4/view-before-author.md before reading the author's round-2 report. The author's reason for allowing successful/no-ID recovery establishes only that a session may have been made; it does not resolve M-2. My findings distinguish deliberate failure/mapping simulation from behavior naturally observed in the real binary.

The worktree remained at 6d204435, with no rebase, branch creation, commit, PR, push, or AO invocation. Both round-2 and whole-landing diffs contain only packages/plugins/agent-opencode/src/index.ts and index.test.ts. Both commit messages are conventional, ASCII, and have no prohibited trailer, emoji, or issue-number reference. git branch -r --contains 6d204435 printed nothing. No tracked file was edited. The old primary build's SHA-256 was unchanged: 51f718792ca024d56d30474a1dfbe616cc3b68e8f76175356666d0554d545467. No install/build/write ran in the primary checkout.

Every real OpenCode call used four separate XDG homes under /tmp/ao2r2-review-PbjHP4, isolated service configuration port **40077**, and an environment without provider credentials. Explicit servers were created with owned Popen handles and terminated through those handles only. API/list calls pointed to http://127.0.0.1:40077; all TUI calls were intercepted, including prompts, so no model turn ran. No existing credential was copied. The 2.0.29 binary was copied read-only from the installed binary; 1.18.35 was unpacked under /tmp from the [official release asset](https://github.com/anomalyco/opencode/releases/download/v1.18.35/opencode-linux-x64.tar.gz), as in round 1. No global service was used for mutations, stopped, or signalled.

Scratch binaries, isolated stores, work directories, and service logs containing the local test password were removed after verification. Reproducer/scripts and logs without credentials remain in /tmp/ao2r2-review-PbjHP4. Author cleanup and the final environment scan are recorded below.

Final cleanup check: no /tmp/ao1* path (including ao1r2-*), no author ao1* tmux socket, no ~/.worktrees/ao1r2-scratch or round-1 scratch directory. Read 130 own-user process environments: zero references to author state or this review's isolated state. 9 own-user environments were permission-denied; their process names were (sd-pam), codex, gpg-agent, opencode, sshd, systemd, xdg-open. I did not bypass permissions or read other users' environments. The inaccessible opencode process was a zombie (PID 1823581), with no running command. The absence claim for process environments is limited to the readable ones. No matching review process remained after terminating the owned servers.

## Appendix: self-contained reproduction of new findings

After building this worktree, save and run the following Python script. It calls only a fake OpenCode CLI, reads the real generated commands, and removes its own temporary directory. The executed copy is /tmp/ao2r2-review-PbjHP4/reproduce-r2.py. The expected output reaches TUI with status 0 in all three cases: mapped-create has stored build despite requested plan (B-1); older-conversation retains ANOTHER_TASK while receiving the current prompt (M-2); failed-readback emits matching data and exits 1 but the script opens TUI and exits 0 (m-2).

~~~python
import json,os,pathlib,subprocess,tempfile,shutil
plugin='/home/taisung/.worktrees/agent-orchestrator/ao-2/packages/plugins/agent-opencode/dist/index.js'
source='''import {create} from PLUGIN;
const a=create(),p={name:'r',repo:'o/r',path:'/tmp',defaultBranch:'main',sessionPrefix:'r'};
const c={sessionId:'r',projectConfig:p,model:'provider/model#xhigh',subagent:'plan',prompt:'current task'};
console.log(JSON.stringify({fresh:a.getLaunchCommand(c),resume:a.getLaunchCommand({...c,projectConfig:{...p,agentConfig:{opencodeSessionId:'ses_old'}}})}));'''.replace('PLUGIN',json.dumps(plugin))
commands=json.loads(subprocess.check_output(['node','--input-type=module','-'],input=source,text=True))
root=pathlib.Path(tempfile.mkdtemp(prefix='ao2r2-repro-'))
try:
 bin=root/'bin';bin.mkdir();cli=bin/'opencode';store=root/'store.json'
 cli.write_text('''#!/usr/bin/env python3
import json,os,sys,pathlib
args=sys.argv[1:];path=pathlib.Path(os.environ['REPRO_STORE']);store=json.loads(path.read_text());case=os.environ['REPRO_CASE']
def flag(k):return args[args.index(k)+1]
def save():path.write_text(json.dumps(store))
if args==['--version']:print('opencode v2.0.29')
elif args[:2]==['session','list']:print(json.dumps([{'id':k,**v} for k,v in store.items()]))
elif args[:1]==['api']:
 op=args[1]
 if op=='session.create':
  if case=='older-conversation':sys.exit(0)
  body=json.loads(flag('-d'));store['ses_new']={**body,'agent':'build','updated':2};save();print(json.dumps({'data':{'id':'ses_new',**store['ses_new']}}))
 else:
  sid=flag('--param').split('=',1)[1];s=store[sid]
  if op=='session.switchModel':s['model']=json.loads(flag('-d'))['model'];save()
  elif op=='session.switchAgent':s['agent']=json.loads(flag('-d'))['agent'];save()
  elif op=='session.get':
   print(json.dumps({'data':{'id':sid,**s}}))
   if case=='failed-readback':print('readback failed after matching JSON',file=sys.stderr);sys.exit(1)
else:print('TUI '+json.dumps({'argv':args,'stored':store[flag('--session')]}))
''');cli.chmod(0o755)
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','LANG','LC_ALL']};env.update(PATH=str(bin)+':'+env['PATH'],REPRO_STORE=str(store))
 for kind in ['DATA','CONFIG','STATE','CACHE']:
  p=root/kind.lower();p.mkdir();env['XDG_'+kind+'_HOME']=str(p)
 for case in ['mapped-create','older-conversation','failed-readback']:
  store.write_text(json.dumps({'ses_old':{'title':'AO:r','updated':1,'conversationMarker':'ANOTHER_TASK','model':{'providerID':'opencode','id':'big-pickle','variant':'default'},'agent':'build'}}))
  p=subprocess.run(['/bin/bash','--norc','-c',commands['resume' if case=='failed-readback' else 'fresh']],cwd=root,env={**env,'REPRO_CASE':case},text=True,capture_output=True,timeout=10)
  print(json.dumps({'case':case,'status':p.returncode,'stdout':p.stdout,'stderr':p.stderr}))
finally:shutil.rmtree(root)
~~~
