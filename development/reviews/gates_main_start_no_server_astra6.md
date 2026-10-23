# Validation: main after the start/stop landing

PASS: all five validation items passed. Full suite: 3596 passed, 1 expected failure, 29 skipped; no differences from r3. Item 1 and all gates ran after the corrected branch switch at 14:28:00 EDT.

```text
git rev-parse HEAD
de7c1bfc82ae7ff0ce87e0e3b896b8fd4e029d2c
git branch --show-current
validate/main-start-no-server
git diff --stat ab13588b HEAD^{tree}
(empty)
git diff --stat e6695161 HEAD -- . ':!development'
(empty)
```

The worktree matches the landed merge tree and the reviewed production source.

Offline install command:

```sh
env -i HOME=/tmp/aogsn/home TMPDIR=/tmp/aogsn/tmp PATH=/tmp/aogsn/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3
```

Exit 0. Summary: `Lockfile is up to date, resolution step is skipped`; `Already up to date`; `HUSKY=0 skip install`; `Done in 1s`.

All package commands below used `env -i HOME=/tmp/aogsn/home TMPDIR=/tmp/aogsn/tmp PATH=/tmp/aogsn/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`. The curated PATH contains cached pnpm 9.15.4, Node 25.7.0, a restricted gh stub, and a tmux shim targeting only `aogsn-tests`; it contains no real agents or npx.

Build, typecheck and lint each exited 0:

```text
pnpm build
packages/core build: Done
packages/cli build: Done
pnpm typecheck
packages/integration-tests typecheck: Done
packages/cli typecheck: Done
pnpm lint
✖ 5 problems (0 errors, 5 warnings)
```

All intermediate build/typecheck package tasks also completed. The five known ESLint findings are:

| File | Line:column | Rule |
| --- | --- | --- |
| packages/cli/src/commands/spawn.ts | 333:24 | @typescript-eslint/no-non-null-assertion |
| packages/core/src/activity-log.ts | 91:31 | @typescript-eslint/no-non-null-assertion |
| packages/core/src/plugin-registry.ts | 232:7 | @typescript-eslint/no-non-null-assertion |
| packages/core/src/session-manager.ts | 2383:11 | no-console |
| packages/core/src/session-manager.ts | 2390:9 | no-console |

ESLint also prints its existing `.eslintignore` migration notice; this is not an additional source finding.

One full `pnpm -r --no-bail test` ran, exit 0. Exact package summary lines:

```text
packages/core test:       Tests  1624 passed | 1 expected fail (1625)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-codex test:       Tests  307 passed (307)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  318 passed (318)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  370 passed (370)
TOTAL: 3596 passed, 1 expected fail, 29 skipped (3626)
```

The totals and every package count equal r3: differences are 0 passed, 0 expected failures and 0 skipped. The single expected failure is the existing core same-ID R3 F-5 case, `kill and restore of one ID: the active record at the end names a live runtime`, marked with `it.fails` in `packages/core/src/__tests__/same-id-defects.test.ts`. There are no unexplained failures. The 29 skips remain 5 in scm-github and 24 in integration-tests.

Red run (exit 1, expected from the 22 defect assertions):

```sh
SAME_ID_DEFECTS=red pnpm -r --no-bail --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode exec vitest run same-id --reporter=json
```

| Round | Passed | Failed | Expected failed |
| --- | ---: | ---: | ---: |
| R1 | 17 | 0 | 0 |
| R2 | 20 | 16 | 16 |
| R3 | 0 | 6 | 6 |
| R4 | 56 | 0 | 0 |

All four red counts match r3. No additional red failure.

Both built-CLI/core smokes passed. Commands used the same fake HOME and TMPDIR, with PATH `/tmp/aogsn/livebin:/tmp/aogsn/bin:/tmp/aogsn/agentbin`; `ao` resolves directly to `node packages/cli/dist/index.js`. The only agent executable there is a scratch Claude stand-in that prints `STAND-IN-ENDED` and exits. The live tmux shim targets `aogsn-live`. Direct tmux inspection used `env -u TMUX /usr/bin/tmux -L aogsn-live`.

(a) `ao start scratch`; wait for stand-in exit; type `ao stop scratch` in its own pane. The detached stop completed, archived the record, stopped worker 2038745, and left no server. Both the captured pane output and detached log are quoted below.

(b) `ao start scratch`; wait for stand-in exit; type `exit`; confirm no server and unchanged active record; `ao start scratch` again. The no-server diagnostic appeared, the stale record was archived, and a new runtime handle/createdAt was stored. Worker 2039230 was reused. Outside `ao stop scratch`, with stdout and stderr captured through separate pipes, exited 0 and stopped that worker. All observed detached stop children exited.

Exact smoke output and before/after records:

<details>
<summary>Smoke transcript</summary>

```text
SMOKE A
AO start scratch RC 0 
STDOUT

Starting orchestrator for scratch


✓ Startup complete

Lifecycle: started (PID 2038745)
Orchestrator: ao session attach sc-orchestrator
Config: /tmp/aogsn/repo/agent-orchestrator.yaml
STDERR
- Starting lifecycle worker
✔ Lifecycle worker started (PID 2038745)
- Creating orchestrator session
✔ Orchestrator session created

STAND-IN ENDED %0
STATE incident before TMUX '65d87335a61a-sc-orchestrator 1792693902\n'
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator generation=2
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:42.331Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693902331,"workspacePath":"/tmp/aogsn/repo"}}

WORKER 2038745 LIVE True
ARCHIVES []
PANE ao stop scratch


Stopping orchestrator for scratch

 ARCHIVED RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/archive/sc-orchestrator_2026-10-22T18-31-43-025Z generation=3
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:42.331Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693902331,"workspacePath":"/tmp/aogsn/repo"}}
prAutoDetect=off

orchestrator-stop-2026-10-22T18-31-42-665Z-2038800-aa1ab47f.stderr.log - Stopping orchestrator session
✔ Orchestrator session stopped

orchestrator-stop-2026-10-22T18-31-42-665Z-2038800-aa1ab47f.stdout.log Lifecycle worker stopped

✓ Orchestrator stopped

  Projects: scratch


STATE incident after TMUX ''
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator ABSENT
WORKER None LIVE False
ARCHIVES ['sc-orchestrator_2026-10-22T18-31-43-025Z']
INCIDENT WORKER ENDED 2038745 True
SMOKE B
AO start scratch RC 0 
STDOUT

Starting orchestrator for scratch


✓ Startup complete

Lifecycle: started (PID 2039230)
Orchestrator: ao session attach sc-orchestrator
Config: /tmp/aogsn/repo/agent-orchestrator.yaml
STDERR
- Starting lifecycle worker
✔ Lifecycle worker started (PID 2039230)
- Creating orchestrator session
✔ Orchestrator session created

STAND-IN ENDED %0
STATE before exit TMUX '65d87335a61a-sc-orchestrator 1792693903\n'
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator generation=5
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:43.532Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693903532,"workspacePath":"/tmp/aogsn/repo"}}

WORKER 2039230 LIVE True
ARCHIVES ['sc-orchestrator_2026-10-22T18-31-43-025Z']
STATE no server before restart TMUX ''
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator generation=5
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:43.532Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693903532,"workspacePath":"/tmp/aogsn/repo"}}

WORKER 2039230 LIVE True
ARCHIVES ['sc-orchestrator_2026-10-22T18-31-43-025Z']
AO start scratch RC 0 
STDOUT

Starting orchestrator for scratch


✓ Startup complete

Lifecycle: already running (PID 2039230)
Orchestrator: ao session attach sc-orchestrator
Config: /tmp/aogsn/repo/agent-orchestrator.yaml
STDERR
- Starting lifecycle worker
✔ Lifecycle worker already running (PID 2039230)
ℹ Orchestrator session sc-orchestrator does not run: no tmux server runs (tmux has-session -t =65d87335a61a-sc-orchestrator could not answer: no server running on /tmp/tmux-44402/aogsn-live). Starting a new one.
- Creating orchestrator session
✔ Orchestrator session created

STATE after restart TMUX '65d87335a61a-sc-orchestrator 1792693903\n'
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator generation=8
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:43.915Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693903915,"workspacePath":"/tmp/aogsn/repo"}}

WORKER 2039230 LIVE True
ARCHIVES ['sc-orchestrator_2026-10-22T18-31-43-025Z', 'sc-orchestrator_2026-10-22T18-31-43-883Z']
STAND-IN ENDED %0
ARCHIVED RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/archive/sc-orchestrator_2026-10-22T18-31-43-025Z generation=3
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:42.331Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693902331,"workspacePath":"/tmp/aogsn/repo"}}
prAutoDetect=off

ARCHIVED RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/archive/sc-orchestrator_2026-10-22T18-31-43-883Z generation=6
worktree=/tmp/aogsn/repo
branch=main
status=working
role=orchestrator
tmuxName=65d87335a61a-sc-orchestrator
project=scratch
agent=claude-code
createdAt=2026-10-22T18:31:43.532Z
runtimeHandle={"id":"65d87335a61a-sc-orchestrator","runtimeName":"tmux","data":{"createdAt":1792693903532,"workspacePath":"/tmp/aogsn/repo"}}
prAutoDetect=off

AO stop scratch RC 0 
STDOUT

Stopping orchestrator for scratch

Lifecycle worker stopped

✓ Orchestrator stopped

  Projects: scratch

STDERR
- Stopping orchestrator session
✔ Orchestrator session stopped

STATE outside stop after TMUX ''
ACTIVE RECORD /tmp/aogsn/home/.agent-orchestrator/65d87335a61a-repo/sessions/sc-orchestrator ABSENT
WORKER None LIVE False
ARCHIVES ['sc-orchestrator_2026-10-22T18-31-45-535Z', 'sc-orchestrator_2026-10-22T18-31-43-025Z', 'sc-orchestrator_2026-10-22T18-31-43-883Z']
RESTART WORKER ENDED 2039230 True
SMOKES PASS
```

</details>

Cleanup evidence:

```text
# Before and after: ls -la --time-style=full-iso /home/taisung/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The before and after listings are byte-identical (comparison asserted). No real agent, Herdr server or default tmux server was invoked. Real workers 65891 and 68422 and the owner's sessions were untouched.

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aogsn-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output: empty. No paths need write attribution.

```text
# Private-server checks, each under the scrubbed scratch environment; exit 1 each
# env -u TMUX /usr/bin/tmux -L aogsn-live list-sessions
no server running on /tmp/tmux-44402/aogsn-live
# env -u TMUX /usr/bin/tmux -L aogsn-tests list-sessions
no server running on /tmp/tmux-44402/aogsn-tests
# /proc scan: live processes with exact HOME=/tmp/aogsn/home; exclude scanner and zombies
[]
# git diff --exit-code
(empty, exit 0)
# git rev-parse HEAD
de7c1bfc82ae7ff0ce87e0e3b896b8fd4e029d2c
```

The first process scan overlapped the results-summary helper, which then exited normally. The final scan above ran after that helper completed and was empty. No manual process signals were needed.

Cleanup completed with non-forced `rm -r /tmp/aogsn` and `rm` for the marker and own stale socket. `/tmp/aogsn`, `/tmp/aogsn-marker`, `/tmp/tmux-44402/aogsn-live` and `/tmp/tmux-44402/aogsn-tests` are all absent. The post-deletion own-process scan was also `[]`.
