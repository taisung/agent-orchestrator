NOT-LAND-SAFE

Review of `273b62c1..b90ac08f`: **0 blockers, 1 major, 1 minor**. Artifact: code and its test doubles. The ordinary 2.0.29 API path works, but its fallback can disregard the configured model and agent after creation fails. Fix M-1 before landing. No tracked file was edited; nothing was committed or pushed.

## Findings

### M-1 — The 2.x creation fallback opens an older session without applying the requested settings

**Location:** `packages/plugins/agent-opencode/src/index.ts:407`, `:409`, `:417`, `:418`.

The failed creation pipeline leaves `SES_ID` empty. The command then searches by AO title regardless of creation's exit status. If a previous session has that title, the 2.x branch opens it with only `--session` and the prompt. The requested model and agent were sent only to the failed creation call; neither is applied to the discovered session. The 1.x branch still applies them as TUI flags. This is a regression in the fallback's settings behavior.

This requires a previous session with the same AO title and a failed creation or an unusable response. It does not affect successful creation. The consequences matter: a request for the `plan` agent can enter a session stored with `build`, and a request for one model can use another. The emitted HTTP error does not prevent the TUI from starting.

**Evidence from the real binary:**

```text
python3 /tmp/ao2-review-QiticP/live-generated.py
requested: opencode-go/muse-spark-1.3-contributor#xhigh, agent=plan
creation: HTTP 400 Bad Request
          InvalidRequestError: Expected Model.Ref | null at ["model"]
next commands: session list --format json
               --session ses_ec3694c98ffeEjI6Aeyl2IJy9Z
shell status: 0
session.get readback: agent=build
                     model=opencode/big-pickle#default
                     tokens.input=0, tokens.output=0, cost=0
session.switchModel / session.switchAgent calls: none
```

The test seeded an older `AO:review-1` session in the isolated store. A wrapper forwarded API/list calls to my server and intercepted the final TUI invocation. For this one failure case it replaced the create body with `{"model":123}` to obtain a real HTTP 400; the valid generated body was independently accepted unchanged. This is deliberate fault injection, not a claim that valid bodies ordinarily get HTTP 400. An independent fake returning HTTP 500 produced the same fallback and exit status.

**Reproducer:** the self-contained script in the appendix reproduces this with a fake CLI and no real OpenCode session. Its `fresh` case produces:

```json
{"case":"fresh","status":0,"stdout":"TUI [\"--session\", \"ses_old\"]\n","stderr":"HTTP 500 Internal Server Error\n"}
```

**Required change:** distinguish a failed create from successful creation with a missing ID. If lookup can recover an existing session, apply and verify the configured model/agent before opening its TUI. Otherwise fail without opening it. Add a failure-plus-title-match test that asserts settings behavior, not only the selected ID.

### m-1 — Resume and restore report success after a failed switch or an invalid model

**Location:** `packages/plugins/agent-opencode/src/index.ts:249` and `:261`; test omission at `packages/plugins/agent-opencode/src/index.test.ts:1515`.

The invalid-model branch returns only `echo ... >&2`. The API-failure branch also ends in a successful `echo`. Bash therefore returns 0 even though no TUI started. The existing failed-switch test checks stderr and absence of a TUI, but never checks the shell status.

**Own evidence, including real 2.0.29 HTTP 404 responses:**

```text
python3 /tmp/ao2-review-QiticP/live-generated.py
reuse, missing ses_missing_review:
  stdout: {"_tag":"SessionNotFoundError", ...}
  stderr: HTTP 404 Not Found
          failed to set the OpenCode model or agent for ses_missing_review
  shell status: 0; TUI calls: 0; subsequent agent switch: skipped
restore, missing ses_missing_review:
  same HTTP 404 and generic error; shell status: 0; TUI calls: 0
resume and restore, model=providerless:
  stderr: OpenCode 2.x needs the model as provider/model[#variant], got: providerless
  shell status: 0; API calls: 0; TUI calls: 0
```

An independent fake also failed the second operation, `session.switchAgent`: the first model switch ran, the agent switch failed, the error was printed, no TUI ran, and the script returned 0. These paths correctly avoid opening the TUI. I classify the status issue as minor because tmux's current launch path does not propagate the script's exit code; I am not claiming that changing this exit code alone fixes AO's spawn reporting.

**Reproducer:** the appendix's `resume` and `invalid` cases. Return a nonzero status after these errors and assert it in tests.

## Checked and found correct

- Bash quoting preserves single/double quotes, spaces, dollar signs, command-substitution text, backticks, and embedded newlines in AO titles, model references, agents, prompts, system-prompt file paths/content, and the pane directory. Independent assertions checked decoded argv/JSON and absence of an injection marker. Five additional 2.x existing-session prompt combinations passed. A model ID containing another slash remains intact. OpenCode session IDs are validated before interpolation; malicious captured IDs are rejected, and invalid configured IDs take the new-session path.
- Successful 2.0.29 `session.create` accepts `title`, `model: {providerID,id,variant}`, `agent`, and `location: {directory}`. Readback shows the correct AO title, work directory, `plan`, and the full model variant. All inspected sessions have zero input/output tokens and zero cost.
- Successful existing-session commands execute `session.switchModel --param sessionID=... -d ...` followed by `session.switchAgent`, then the TUI without model/agent flags. Real readback after that order contains `opencode-go/glm-5.3#default` and `plan`. Neither switch requires a model turn.
- New-session capture failure with no matching lookup result prints the missing-session error, returns 1, and starts no TUI. API create errors with no lookup match also print the real response/error and return 1. A providerless model on the new-session path fails before an API call, with status 1. Resumes without model or agent settings retain the same plain command on both generations.
- The 1.x command fragments are byte-identical to the old primary-checkout build. All CLI argv sequences, stderr, and statuses matched across 51 fresh/existing/restore configurations. The complete command strings intentionally differ when the version wrapper is needed: 7 full strings identical, 44 wrapped strings different. This distinction qualifies the author's blanket wording about command-string identity.
- `detect()` correctly uses `--version`. Its real exit codes are 0 on both binaries; the old positional `version` returns 0 with a directory error on 1.18.35 and 1 with ENOENT on 2.0.29.
- Only the two requested plugin files changed in the reviewed commit. Its subject is conventional; its body is ASCII, has no emoji, no issue-number reference, and no `Co-Authored-By` trailer. `git branch -r --contains b90ac08f` printed nothing.

## Version probe and failure behavior

Commands: `node /tmp/ao2-review-QiticP/harness.mjs`, `node /tmp/ao2-review-QiticP/extra.mjs`, and `python3 /tmp/ao2-review-QiticP/missing.py`. These execute the generated bash commands or their exact probe.

| Version stdout | Parsed major | Selected path | Assessment |
|---|---:|---|---|
| `1.18.35` | 1 | legacy | Correct for the tested 1.x binary. |
| `opencode v2.0.29` | 2 | API | Correct for the tested 2.x binary. |
| `2.1.0-beta.1` | 2 | API | Correct under the intended major-version policy. |
| `10.0.0` | 10 | API | Multi-digit parsing is correct; future API compatibility remains an assumption. |
| empty stdout | empty, defaults to 0 | legacy | Matches the documented compatibility fallback; it cannot identify an unknown binary's actual capabilities. |
| missing executable | empty, defaults to 0 | legacy | Cannot launch either path. The hidden probe error is followed by visible `opencode: command not found` errors and the missing-session message; final status 1, no TUI. |

The probe does not preserve the executable's exit status. For empty/unparsable output it intentionally chooses the previous behavior, not a proven compatible CLI. That limitation is explicit in the source and is not a separate finding.

## Build and test evidence

All requested commands ran in this worktree, never the primary checkout. Exact summary lines:

```text
pnpm install                           exit 0
  . prepare: Done
  Done in 1.3s
pnpm build                             exit 0
  Scope: 14 of 15 workspace projects
  packages/plugins/agent-opencode build: Done
  packages/cli build: Done
pnpm --filter @aoagents/ao-plugin-agent-opencode test       exit 0
  Test Files  1 passed (1)
       Tests  119 passed (119)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck  exit 0
  > tsc --noEmit
pnpm lint                              exit 0
  ✖ 6 problems (0 errors, 6 warnings)
```

Install warned about the missing CLI `dist/index.js` before the build, which then completed successfully. The six lint warnings are on unchanged statements. Full `pnpm test` was not run; it was optional for this review.

**Non-vacuity:** copied the new test file to `/tmp/ao2-review-QiticP/old-tests/src/index.test.ts`; wrote `git show 273b62c1:packages/plugins/agent-opencode/src/index.ts` into that scratch tree's `src/index.ts`; linked only the worktree package's dependencies. Ran:

```text
cd /tmp/ao2-review-QiticP/old-tests
/home/taisung/.worktrees/agent-orchestrator/ao-2/packages/plugins/agent-opencode/node_modules/.bin/vitest run src/index.test.ts
Test Files  1 failed (1)
     Tests  9 failed | 110 passed (119)
```

Failures were the 2.x tests for: captured-session launch; API creation without old flags; variant preservation; newest-title fallback; providerless-model rejection; existing-session model/agent changes; failed model switch; restore's project model; and detection. The author reported eight failures; my run produced nine, including newest-title fallback.

**Fake CLI fidelity:** `python3 /tmp/ao2-review-QiticP/fidelity.py` compared the test's literal fake with the real 2.0.29 binary:

| Harmless command | Real / fake exit status | Relevant behavior |
|---|---|---|
| `--version` | 0 / 0 | Exactly `opencode v2.0.29` on stdout. |
| positional `version` in a directory without `version/` | 1 / 1 | Directory error; fake wording omits the real ENOENT details. |
| `run --command true` | 1 / 1 | Both reject `--command` in `opencode run`. |
| top-level `--model opencode-go/glm-5.3` | 1 / 1 | Both reject `--model`. |
| top-level `--agent plan` | 1 / 1 | Both reject `--agent`. |
| `--help` | 0 / 1 | Fidelity limit: the fake rejects help. |

The fake also omits the real usage text printed to stdout on flag errors. Those differences do not invalidate the paths the new tests actually exercise, but the fake is not a complete CLI emulator. Its `apiFail` behavior fails switches, not creation; it does not cover M-1's failed-creation case. New tests mostly assert relations: captured ID equals TUI ID, JSON model round-trips to the input model/variant, run flags equal TUI flags, and location equals real cwd. Older string-containment tests remain. The failed-switch test's missing status assertion is the gap identified in m-1.

## Independence, isolation, and cleanup

I formed my shell/API/1.x compatibility conclusions before reading `/home/taisung/.worktrees/agent-orchestrator/ao-1/.agent_report.md`.

The old module was imported read-only from `/home/taisung/local/agent-orchestrator/packages/plugins/agent-opencode/dist/index.js`. Its SHA-256 before and after was `51f718792ca024d56d30474a1dfbe616cc3b68e8f76175356666d0554d545467`. No install/build ran there. HEAD remained `b90ac08f`; there was no rebase, branch creation, commit, PR, push, or global AO invocation.

The real 2.0.29 binary was copied to `/tmp/ao2-review-QiticP/opencode2`. The 1.18.35 binary came from the [official release asset](https://github.com/anomalyco/opencode/releases/download/v1.18.35/opencode-linux-x64.tar.gz), unpacked only under `/tmp`. Every real session creation/change used four separate XDG homes under `/tmp/ao2-review-QiticP`, a fresh scratch directory, a sanitized environment without provider credentials, and isolated service port **57353** set in that isolated config. Calls to my explicit server added `--server http://127.0.0.1:57353`; TUI calls were intercepted to prevent model turns. No credential was copied from any existing store. The local test server used its own password created for this test. No global service was stopped, signalled, or used for session mutation.

An early shell probe spawned from Node unexpectedly read `.bashrc`, which prepended the global binary's path ahead of the fake. All four XDG homes and isolated port were already set, and that case had no prompt. It created only an isolated session/service, with no model turn. I corrected the harness to use `bash --norc`; the independently started isolated daemon PID 1199824 was validated by its exact XDG environment and command, then terminated by that PID. Explicit servers were terminated only through the `Popen` objects I started. A final scan found no active process with the review scratch path in its readable environment. Scratch binaries, XDG stores, and service logs containing local test secrets were removed after testing; the reproducer and evidence logs without secrets remain under `/tmp/ao2-review-QiticP`.

**Author cleanup:** my checks found no `/tmp/ao1-*`, no `/home/taisung/.worktrees/scratch`, no `ao1-*` socket in `/tmp/tmux-$(id -u)/`, and no `/tmp/ao1` reference in the readable own-user process environments (158 in an earlier scan; 150 in the final cleanup scan). Ten own-user environments were permission-denied in the final scan: systemd/PAM, sshd/SFTP, gpg-agent, and two zombies. I did not bypass those permissions or read other users' environments. Thus I found no residue, with that explicit limit on process-environment verification.

## Appendix: self-contained failure reproducer

After building this worktree, save the following as a Python file and run it. It invokes only a fake `opencode`, cleans its own temporary directory, and demonstrates both findings. The executed copy is `/tmp/ao2-review-QiticP/reproduce-failures.py`.

```python
import json, os, pathlib, subprocess, tempfile, shutil
plugin='/home/taisung/.worktrees/agent-orchestrator/ao-2/packages/plugins/agent-opencode/dist/index.js'
source='''import {create} from PLUGIN;
const a=create(),p={name:'r',repo:'o/r',path:'/tmp',defaultBranch:'main',sessionPrefix:'r'};
const base={sessionId:'r',projectConfig:p,model:'provider/new-model',subagent:'plan'};
console.log(JSON.stringify({
 fresh:a.getLaunchCommand(base),
 resume:a.getLaunchCommand({...base,projectConfig:{...p,agentConfig:{opencodeSessionId:'ses_absent'}}}),
 invalid:a.getLaunchCommand({...base,model:'providerless',projectConfig:{...p,agentConfig:{opencodeSessionId:'ses_absent'}}})
}));'''.replace('PLUGIN',json.dumps(plugin))
commands=json.loads(subprocess.check_output(['node','--input-type=module','-'],input=source,text=True))
root=pathlib.Path(tempfile.mkdtemp(prefix='ao2-repro-'))
try:
 bin=root/'bin';bin.mkdir(); cli=bin/'opencode'
 cli.write_text('''#!/usr/bin/env python3
import json,sys
args=sys.argv[1:]
if args==['--version']:print('opencode v2.0.29')
elif args[:2]==['session','list']:print(json.dumps([{'id':'ses_old','title':'AO:r','updated':1}]))
elif args[:2]==['api','session.create']:print('HTTP 500 Internal Server Error',file=sys.stderr);sys.exit(1)
elif args[:1]==['api']:print('HTTP 404 Not Found',file=sys.stderr);sys.exit(1)
else:print('TUI '+json.dumps(args))
''');cli.chmod(0o755)
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','LANG','LC_ALL']};env['PATH']=str(bin)+':'+env['PATH']
 for kind in ['DATA','CONFIG','STATE','CACHE']:
  path=root/kind.lower();path.mkdir();env['XDG_'+kind+'_HOME']=str(path)
 for name,command in commands.items():
  p=subprocess.run(['/bin/bash','--norc','-c',command],cwd=root,env=env,text=True,capture_output=True,timeout=10)
  print(json.dumps({'case':name,'status':p.returncode,'stdout':p.stdout,'stderr':p.stderr}))
finally:shutil.rmtree(root)
```
