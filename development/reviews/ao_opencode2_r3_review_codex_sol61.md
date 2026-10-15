LAND-SAFE

Review of 6d204435..8ae92e83 and the complete landing 273b62c1..8ae92e83 within the owner's narrow R7 scope: **0 blockers, 0 majors, 0 minors**. B-1, M-2, and m-2 are closed. No new finding IDs are assigned. I found no defect in the changed lines or regression in the required checks.

## Findings

None within the authorized scope.

## Closure evidence

The independent fake and real-store fault tests reused the round-2 harnesses, copied under /tmp/ao2r3-review-YAw1L6 with the current build and updated expected outcomes. TUI calls were intercepted, including prompts, so no model turn ran. “TUI call” means the generated command reached that invocation; successful cases were independently read back from the real isolated store.

### B-1 closed: valid-ID creation verifies requested settings

**Source:** packages/plugins/agent-opencode/src/index.ts:497 and :501 call the shared readback before the TUI; :175 and :176 compare only the requested model and agent.

Commands:

~~~text
node /tmp/ao2r3-review-YAw1L6/matrix.mjs
node /tmp/ao2r3-review-YAw1L6/focus.mjs
python3 /tmp/ao2r3-review-YAw1L6/live-matrix.py
python3 /tmp/ao2r3-review-YAw1L6/live-focus.py
~~~

| Case | Independent fake | Controlled real-store case |
|---|---|---|
| Valid create ID, stored agent differs from requested plan | Exit 1; no TUI; create then get | Exit 1; no TUI; stored build shown on stderr |
| Valid create ID, stored model differs from requested Muse Spark#xhigh | Exit 1; no TUI; create then get | Exit 1; no TUI; stored opencode/big-pickle#default shown |
| Only model requested; service supplies another agent | Exit 0; TUI; model checked | Exit 0; Muse Spark#xhigh retained, unrequested build accepted |
| Only agent requested; service supplies another model | Exit 0; TUI; agent checked | Exit 0; plan retained, unrequested Big Pickle accepted |
| Neither model nor agent requested | Exit 0; no get | Exit 0; generated calls contain create only |
| Only requested model/agent itself differs | Exit 1; no TUI | Exit 1; no TUI |

Representative live results:

~~~text
fresh-simulated-mapped-agent:
  calls: session.create, session.get
  stderr: OpenCode stored agent "build" and model {...}
          failed to set the OpenCode model or agent for ses_ec2f7ba9affekIUwa9V4sVYkLf
  exit: 1; TUI calls: 0
fresh-mapped-model:
  stderr: OpenCode stored agent "plan" and model
          {"id":"big-pickle","providerID":"opencode","variant":"default"}
          failed to set the OpenCode model or agent for ses_ec2f5c4bcffekCcTKb3D2fZTlk
  exit: 1; TUI calls: 0
~~~

As in round 2, the live mapping cases deliberately changed the forwarded request to simulate a service mapping; I am not claiming a natural alias normalization by 2.0.29. Real API creation, get, and stored-state readback were used. The independent fake maps stored values while accepting the generated request unchanged. Both now reject the mismatch.

### M-2 closed: unusable IDs stop without any title lookup

**Source:** index.ts:495 immediately stops when ID capture fails. The 2.x command assembled at :507 contains no title lookup. The unchanged legacy branch retains its own lookup.

The focused fake exercised five outputs — empty, non-JSON, malformed ID, ID without the ses_ prefix, and bare ses_ prefix — with zero, one, and several older title matches: **all 15 cases exit 1, call no TUI, call no session list, and leave the seeded store unchanged**.

The live harness also replayed empty output and malformed IDs both with a real create whose response was suppressed/corrupted and with a create stub that made no session. No-match and several-match cases were included. All stop with exit 1, no TUI, and no list call. This includes a genuinely created session whose returned ID could not be parsed: it is not recovered by title.

Representative output:

~~~text
zero-noop / zero-malformed-noop / zero-suppress / zero-malformed /
zero-no-match / zero-several-matches:
  exit: 1
  operations: session.create only
  session list calls: 0
  TUI calls: 0
  stderr: [unusable response, if any]
          failed to discover OpenCode session ID for AO:<id>
~~~

An empty response produces one empty stderr line before the error. Malformed nonempty responses are printed before the error. The new command ends without reaching the TUI; in the retained runtime's launch script this returns to the pane shell. It does not modify an older conversation.

### m-2 closed: get exit status is checked before matching JSON

**Source:** index.ts:303 captures OC_GET_STATUS immediately after the get command substitution. The checker at :169 rejects nonzero status before parsing/comparing the response. The same helper is used for fresh creation, resume, and restore.

All three matching-output/nonzero-exit cases now stop in the independent fake and the controlled live harness:

| Path | Generated API calls | Exit | TUI |
|---|---|---:|---|
| New-session check | create, get | 1 | None |
| Resume | switchModel, switchAgent, get | 1 | None |
| Restore | switchModel, get | 1 | None |

The live wrapper performed a real successful get and then emitted its matching body with exit 1. The new stderr includes the injected failure, the response body, the explicit get-status diagnostic, and the settings-failure message:

~~~text
injected readback failure after valid JSON
{"data":{...matching stored settings...}}
opencode api session.get exited with status 1
failed to set the OpenCode model or agent for <id>
~~~

The original round-2 appendix was executed unchanged against this worktree's new build:

~~~text
python3 /tmp/ao2r2-review-PbjHP4/reproduce-r2.py
mapped-create:      status 1, stdout empty, stored-values error; no TUI
older-conversation: status 1, stdout empty, discover-ID error; no TUI
failed-readback:    status 1, stdout empty, get-status and settings errors; no TUI
~~~

## Changed-line audit and regression checks

- Read the complete round-3 source and test diff. Production changes are confined to the three findings and their shared helper. New API construction preserves shell escaping for the JSON body and session parameter.
- The get response is captured as data, emitted through quoted printf, and passed to the checker on stdin. The exit status is captured before another command can overwrite it and is passed as a quoted separate argument. Expected settings remain JSON-encoded and shell-escaped; changing the checker's expected-value argument from argv[1] to argv[2] is reflected in the caller.
- Repeated the quoting harness for titles, model/variant, agent, prompts, system-prompt file paths/content, and working directory, including quotes, spaces, dollar signs, backticks, command-substitution text, and embedded newlines. Five resume prompt combinations passed through the new helper. No injection marker appeared.
- Successful real 2.0.29 creation performs create/get before the TUI and stores the requested title, directory, model/variant, and plan agent. Successful resume and restore still switch/get correctly. Omitted variant, explicit default, and xhigh readbacks pass.
- Real HTTP 400 creation failure still prints the API response and create-failure message, exits 1, makes no list/TUI call, and leaves the older seed unchanged. Resume/restore model-switch failures, the resume agent-switch failure after a good model switch, real HTTP 404 readback errors, and providerless models all stop with exit 1 and no TUI. Providerless models make no API call. Restore has no agent-switch operation.
- The 1.x byte comparison imports the old primary-checkout build read-only. A direct full-command comparison of 51 configurations found seven commands identical as a whole and 44 with the old command as the exact legacy branch; zero differing legacy branches. A separate execution comparison found identical 1.x CLI argv, stderr, and status. Its title fallback remains.
- Real --version exits 0 on isolated 1.18.35 and 2.0.29. Positional version returns 0 with a directory error on 1.18.35 and 1/ENOENT on 2.0.29. detect() remains on --version, and the generation detection tests pass.
- No new line of inquiry was opened beyond items 1–8.

Exact version-probe results:

| stdout | Parsed major | Path | Assessment |
|---|---:|---|---|
| 1.18.35 | 1 | Legacy | Correct |
| opencode v2.0.29 | 2 | API | Correct |
| 2.1.0-beta.1 | 2 | API | Correct major policy |
| 10.0.0 | 10 | API | Multi-digit parse correct; future compatibility remains assumed |
| Empty | Empty, defaults to 0 | Legacy | Documented compatibility default |
| Missing executable | Empty, defaults to 0 | Legacy | Command-not-found errors and final discover-ID error; exit 1, no TUI |

## Tests and required commands

All commands ran in this worktree:

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
       Tests  148 passed (148)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck  exit 0
  > tsc --noEmit
pnpm lint                               exit 0
  ✖ 6 problems (0 errors, 6 warnings)
~~~

The warnings are on unchanged statements. Full monorepo tests were optional and were not run by me.

**Non-vacuity:** copied the current tests into /tmp/ao2r3-review-YAw1L6/old-tests, put git show 6d204435:packages/plugins/agent-opencode/src/index.ts in that scratch tree's src/index.ts, and linked the worktree package dependencies. No tracked file was swapped. Ran the package Vitest binary in that scratch tree:

~~~text
Test Files  1 failed (1)
     Tests  18 failed | 130 passed (148)
~~~

Failures:

- launch command against OpenCode 1.x and 2.x CLIs > 2.x: reads the created session back, then opens the TUI on it with the requested settings
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 with 'empty output' stops without a title lookup
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 with 'malformed ID' stops without a title lookup
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 with 'ID without the ses_ prefix' stops without a title lookup
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 with 'output that is not JSON' stops without a title lookup
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 without output stops without a title lookup ('model and agent')
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 without output stops without a title lookup ('model only')
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 without output stops without a title lookup ('agent only')
- 2.x launch when session.create fails or returns no session ID > a create that exits 0 without output stops without a title lookup ('no model and no agent')
- 2.x launch checks the settings that session.create stored > stops with status 1 and no TUI when the service stores 'another agent'
- 2.x launch checks the settings that session.create stored > stops with status 1 and no TUI when the service stores 'another model'
- 2.x launch checks the settings that session.create stored > stops when the stored variant differs from a request without a variant
- 2.x launch checks the settings that session.create stored > stops with status 1 and no TUI when 'session.get fails'
- 2.x launch checks the settings that session.create stored > stops with status 1 and no TUI when 'session.get prints the session and ex…'
- 2.x launch checks the settings that session.create stored > checks 'only the model' when only that is requested
- 2.x launch checks the settings that session.create stored > checks 'only the agent' when only that is requested
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'resume' stops with status 1 and no TUI when session.get prints the session and exits 1
- existing-session and restore commands against OpenCode 1.x and 2.x CLIs > 2.x: 'restore' stops with status 1 and no TUI when session.get prints the session and exits 1

The current fake can store settings different from the create request through createStores. It also supports arbitrary successful-create output without creating a session and a nonzero get exit after matching output. Failure tests assert exit status and no TUI; the missing-ID cases assert no list and unchanged old state. Success and requested-only tests inspect the opened session's stored fields and exact API order. These tests exercise the three fixes rather than just matching source strings.

## Scope and independence

HEAD stayed at 8ae92e83. Its parent is 6d204435; no rebase occurred. The complete landing changes only packages/plugins/agent-opencode/src/index.ts and index.test.ts. All three landing messages are conventional and ASCII, with no Co-Authored-By trailer, emoji, or issue-number reference. git branch -r --contains 8ae92e83 printed nothing. No tracked file was edited; no branch, commit, PR, push, or AO invocation was made.

The old primary-checkout plugin was only imported/read. Its SHA-256 before and after was 51f718792ca024d56d30474a1dfbe616cc3b68e8f76175356666d0554d545467. No install/build/write ran in the primary checkout.

I recorded my independent LAND-SAFE view and closure evidence in /tmp/ao2r3-review-YAw1L6/view-before-author.md before reading the author's round-3 report. The author report agrees on the fixes, but its full-suite and live-pane claims are not substituted for my own runs.

Retained observations for the later 2.x arc, without finding IDs: the unchanged 1.x fallback has the previously identified conversation-identity risk, and the retained tmux launch path does not propagate a launch-script failure to ao spawn. They are outside these three fixes, were already discussed in earlier rounds, and do not decide this verdict.

## Isolation and cleanup

Every real OpenCode invocation used separate XDG data, config, state, and cache homes under /tmp/ao2r3-review-YAw1L6. Isolated service configuration port was **48789**, and real API/list calls used the explicit local server URL. The test server password was generated for this isolated test; no existing credential was copied. All TUI calls were intercepted, so no model turn ran. Real readbacks showed zero input/output tokens and zero cost.

I started explicit servers through owned Popen handles and terminated only those exact processes through those handles. I did not use or signal a global service. The 2.0.29 binary was copied read-only into the scratch directory. The isolated 1.18.35 binary was unpacked from the [official release asset](https://github.com/anomalyco/opencode/releases/download/v1.18.35/opencode-linux-x64.tar.gz). No global AO command or real AO configuration was used.

Final cleanup evidence follows.

Removed the review binaries, isolated stores, work directories, and service logs with the local test password. Evidence scripts and logs without provider credentials remain under /tmp/ao2r3-review-YAw1L6. Final scan: 130 readable own-user process environments, zero author-state matches, zero review-state matches. No /tmp/ao1* paths, author ao1* tmux sockets, ~/.worktrees/ao1*-scratch directories, or round-1 scratch directory remain.

9 own-user process environments were permission-denied; process names were (sd-pam), codex, gpg-agent, opencode, sshd, systemd, xdg-open. The opencode entry, if present, is a zombie. I did not bypass permissions or read other users' environments. The environment absence check is explicitly limited to readable environments.
