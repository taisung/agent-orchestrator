# Main validation after Claude Code activity round

**PASS — items 1–5 pass.** 3269 passed, 11 expected fail, 29 skipped; no unexplained failure. Red counts 0/16/6/22. All ten private CLI replays pass. The owner’s gate prerequisite for the primary rebuild is satisfied; this session did not rebuild/deploy that checkout.

Validated on `validate/main-claude-detect`, HEAD `ce93ba673da0054f633a258c807080c8aa09538c`. Validation only; no source edit, design review, commit, push, PR or primary-checkout rebuild.

## 1. Revision and source identity

```text
$ git rev-parse HEAD
ce93ba673da0054f633a258c807080c8aa09538c
$ git diff --stat 53cfd6a8 HEAD -- . ':!development'
(no output)
```

The tracked source outside `development/` is byte-equal to the reviewed tree. Fresh marker `/tmp/aogm-marker`; scratch `/tmp/aogm/ao56`. Every helper, node, pnpm, CLI and test uses `env -i`, fake HOME and TMPDIR, with a private tmux shim and an offline gh stub. No real agent binary is placed on PATH. All private resources belong to this validation run.

## 2. Install, build, typecheck and lint

All commands run at the worktree root, under `env -i HOME=/tmp/aogm/ao56/home PATH=/tmp/aogm/ao56/bin:/usr/bin:/bin TMPDIR=/tmp/aogm/ao56/tmp LANG=C.UTF-8`.

| Command | Result |
| --- | --- |
| `CI=true HUSKY=0 pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3` | exit 0; frozen lockfile, existing permanent store |
| `pnpm build` | exit 0; 12 package `build: Done` lines |
| `pnpm typecheck` | exit 0; 13 package `typecheck: Done` lines |
| `pnpm lint` | exit 0; `5 problems (0 errors, 5 warnings)` |

Warnings match review r1 exactly: non-null assertions in `packages/cli/src/commands/spawn.ts:333`, `packages/core/src/activity-log.ts:91`, `packages/core/src/plugin-registry.ts:232`; console statements in `packages/core/src/session-manager.ts:2335,2342`. ESLint also prints its existing `.eslintignore` migration notice. No new warning or error.


## 3. Full test run and comparison

One `pnpm -r --no-bail test`, after the successful build, exit 0. Each summary below is quoted verbatim with terminal color escapes removed. Review r1 is the recorded `53cfd6a8` run.

| Package | Review r1 summary | This run summary | Difference |
| --- | --- | --- | --- |
| `packages/core` | `1548 passed | 11 expected fail (1559)` | `1548 passed | 11 expected fail (1559)` | 0 |
| `packages/plugins/agent-gemini` | `67 passed (67)` | `67 passed (67)` | 0 |
| `packages/plugins/agent-codex` | `280 passed (280)` | `280 passed (280)` | 0 |
| `packages/plugins/notifier-desktop` | `26 passed (26)` | `26 passed (26)` | 0 |
| `packages/plugins/agent-claude-code` | `241 passed (241)` | `241 passed (241)` | 0 |
| `packages/plugins/runtime-herdr` | `50 passed (50)` | `50 passed (50)` | 0 |
| `packages/plugins/tracker-github` | `42 passed (42)` | `42 passed (42)` | 0 |
| `packages/plugins/scm-github` | `140 passed | 5 skipped (145)` | `140 passed | 5 skipped (145)` | 0 |
| `packages/plugins/runtime-tmux` | `69 passed (69)` | `69 passed (69)` | 0 |
| `packages/plugins/workspace-worktree` | `70 passed (70)` | `70 passed (70)` | 0 |
| `packages/plugins/agent-opencode` | `322 passed (322)` | `322 passed (322)` | 0 |
| `packages/integration-tests` | `91 passed | 24 skipped (115)` | `91 passed | 24 skipped (115)` | 0 |
| `packages/cli` | `323 passed (323)` | `323 passed (323)` | 0 |

**Total: 3269 passed, 11 expected fail, 29 skipped, 0 unexpected failures**, identical to review r1. No package differs. The 11 expected failures are the existing core same-ID defect cases; the red run exposes exactly those same 11 core failures. The 29 skipped tests are 5 SCM tests and 24 integration tests, unchanged. The live OpenCode integration probe finds no `opencode` on PATH and skips; no real agent is started.

Quoted summary lines:

```text
packages/core test:       Tests  1548 passed | 11 expected fail (1559)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  280 passed (280)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  323 passed (323)
```

## 4. Same-ID red gate

`SAME_ID_DEFECTS=red pnpm exec vitest run <same-ID files of package> --reporter=json --outputFile=<scratch JSON>` ran the 14 existing defect/reuse-window files, grouped by their nine packages. Individual package commands with defect failures intentionally exit 1; the checker parses those failure names by their `[same-id Rn]` prefix.

| Round | Review r1 expected failures | This run | Difference |
| --- | ---: | ---: | ---: |
| R1 | 0 | 0 | 0 |
| R2 | 16 | 16 | 0 |
| R3 | 6 | 6 | 0 |
| R4 | 22 | 22 | 0 |
| Total | 44 | 44 | 0 |

48 controls passed. These are the intentionally exposed existing defects, with no change from review r1. The full suite remains a separate single invocation without `SAME_ID_DEFECTS=red`.

Per-package red results:

| Package | Files | Passed | Expected red failures | Exit |
| --- | ---: | ---: | ---: | ---: |
| `packages/cli` | 1 | 2 | 0 | 0 |
| `packages/core` | 2 | 23 | 11 | 1 |
| `packages/plugins/agent-claude-code` | 1 | 1 | 1 | 1 |
| `packages/plugins/agent-codex` | 1 | 1 | 3 | 1 |
| `packages/plugins/agent-gemini` | 1 | 1 | 3 | 1 |
| `packages/plugins/agent-opencode` | 2 | 1 | 4 | 1 |
| `packages/plugins/runtime-herdr` | 2 | 4 | 5 | 1 |
| `packages/plugins/runtime-tmux` | 2 | 12 | 11 | 1 |
| `packages/plugins/workspace-worktree` | 2 | 3 | 6 | 1 |

The 11 core expected failures, confirmed by their red-run names:

- `[same-id R4] B-7 item 1: hasOtherOpenCodeRecord reads the content of the latest archive cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name`
- `[same-id R4] B-7 item 2: the recovery validator keeps a workspace check that rejects as unknown a workspace.exists that rejects (git could not start) gives a live session no action`
- `[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when the herdr binary cannot start`
- `[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when the herdr command times out`
- `[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers text that is not JSON`
- `[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers an error envelope that is not 'pane not found'`
- `[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check isHerdrProcessRunning rejects when herdr answers a result without process_info`
- `[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime`
- `[same-id R4] D-D: older reads that answer 'nothing' when they cannot check spawn does not take a session number while the archive directory cannot be checked`
- `[same-id R4] D-D: older reads that answer 'nothing' when they cannot check cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked`
- `[same-id R4] D-D: older reads that answer 'nothing' when they cannot check recovery: a workspace that cannot be checked does not give a live session the cleanup action`

## 5. Built CLI replay

Each case invokes `node <worktree>/packages/cli/dist/index.js send gm-N --timeout 1 [--no-wait] 'Validation replay message.'` under the sanitized environment, plus `AO_CONFIG_PATH=/tmp/aogm/ao56/replay.yaml`, `AO_STATE_ROOT=/tmp/aogm/ao56/state`, and private `aogm-live-ao56`. The config is not named for automatic discovery and lies outside scratch TMPDIR. The stub is a raw Python terminal program with alternate-screen and bracketed-paste modes, 180×100; it never launches an agent. Before each send, the whole captured pane equals the fixture after removing trailing terminal padding only. Built core/CLI session-manager assertions independently verify each scratch record resolves to the requested Claude or Codex plugin and exact runtime ID (no default-agent fallback).

The idle Claude case redraws the real running fixture on initial Enter; every other case holds its fixture. The unchanged five-second polling interval means `--timeout 1` refuses/sends after the first five-second poll. The logging tmux shim records every key argv, and the raw byte log independently agrees. `--no-wait` cases have only clear/text/initial Enter; verification sends no key.

**gm-1: idle**, `claude-2.1.307-idle-bypass.txt`, regular send, exit 0, 3.062 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.408, "argv": ["send-keys", "-t", "=gm-1:", "C-u"]}, {"t": 0.649, "argv": ["send-keys", "-t", "=gm-1:", "-l", "Validation replay message."]}, {"t": 0.996, "argv": ["send-keys", "-t", "=gm-1:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-2: running**, `claude-2.1.306-running-01.txt`, regular send, exit 0, 8.178 s.

```text
Waiting for gm-2 to become idle...
Timeout waiting for idle. Sending anyway.
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 5.524, "argv": ["send-keys", "-t", "=gm-2:", "C-u"]}, {"t": 5.774, "argv": ["send-keys", "-t", "=gm-2:", "-l", "Validation replay message."]}, {"t": 6.121, "argv": ["send-keys", "-t", "=gm-2:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-3: dialog**, `claude-2.1.304-dialog-t1-01_before.txt`, regular send, exit 1, 5.433 s.

```text
Waiting for gm-3 to become idle...
Timeout waiting for gm-3: session is waiting for interactive input; not sending.
```

tmux key log (seconds after starting the CLI): `[]`.

Pane bytes: `""`; total Enter count 0.

**gm-4: dialog-no-wait**, `claude-2.1.304-dialog-t1-01_before.txt`, `--no-wait`, exit 0, 3.075 s.

```text
Message sent — the pane waits for an answer: check gm-4 (tmux pane =gm-4:)
```

tmux key log (seconds after starting the CLI): `[{"t": 0.413, "argv": ["send-keys", "-t", "=gm-4:", "C-u"]}, {"t": 0.662, "argv": ["send-keys", "-t", "=gm-4:", "-l", "Validation replay message."]}, {"t": 1.008, "argv": ["send-keys", "-t", "=gm-4:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-5: codex-01**, `codex-0.163.0-running-01.txt`, `--no-wait`, exit 0, 3.008 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.364, "argv": ["send-keys", "-t", "=gm-5:", "C-u"]}, {"t": 0.618, "argv": ["send-keys", "-t", "=gm-5:", "-l", "Validation replay message."]}, {"t": 0.959, "argv": ["send-keys", "-t", "=gm-5:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-6: codex-02**, `codex-0.163.0-running-02.txt`, `--no-wait`, exit 0, 3.011 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.373, "argv": ["send-keys", "-t", "=gm-6:", "C-u"]}, {"t": 0.616, "argv": ["send-keys", "-t", "=gm-6:", "-l", "Validation replay message."]}, {"t": 0.96, "argv": ["send-keys", "-t", "=gm-6:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-7: codex-03**, `codex-0.163.0-running-03.txt`, `--no-wait`, exit 0, 3.034 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.39, "argv": ["send-keys", "-t", "=gm-7:", "C-u"]}, {"t": 0.63, "argv": ["send-keys", "-t", "=gm-7:", "-l", "Validation replay message."]}, {"t": 0.969, "argv": ["send-keys", "-t", "=gm-7:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-8: codex-04**, `codex-0.163.0-running-04.txt`, `--no-wait`, exit 0, 3.037 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.384, "argv": ["send-keys", "-t", "=gm-8:", "C-u"]}, {"t": 0.626, "argv": ["send-keys", "-t", "=gm-8:", "-l", "Validation replay message."]}, {"t": 0.968, "argv": ["send-keys", "-t", "=gm-8:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-9: codex-05**, `codex-0.163.0-running-05.txt`, `--no-wait`, exit 0, 3.012 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.364, "argv": ["send-keys", "-t", "=gm-9:", "C-u"]}, {"t": 0.603, "argv": ["send-keys", "-t", "=gm-9:", "-l", "Validation replay message."]}, {"t": 0.944, "argv": ["send-keys", "-t", "=gm-9:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

**gm-10: codex-06**, `codex-0.163.0-running-06.txt`, `--no-wait`, exit 0, 2.971 s.

```text
Message sent and processing
```

tmux key log (seconds after starting the CLI): `[{"t": 0.344, "argv": ["send-keys", "-t", "=gm-10:", "C-u"]}, {"t": 0.585, "argv": ["send-keys", "-t", "=gm-10:", "-l", "Validation replay message."]}, {"t": 0.928, "argv": ["send-keys", "-t", "=gm-10:", "Enter"]}]`.

Pane bytes: `"\u0015Validation replay message.\r"`; total Enter count 1.

The idle send begins typing at +0.408 s, with no Waiting line. Running waits and first types at +5.524 s. The regular dialog refuses with zero bytes/keys. The no-wait dialog prints the answer line after its one initial Enter. All six Codex fixtures print exactly `Message sent and processing`, exit 0, with one initial Enter and zero verification keys.

## 6. Isolation and cleanup evidence

`PATH` checks for `claude`, `codex`, `gemini`, `opencode`, `herdr` and `ao` each returned `None` in the exact sanitized PATH used by the gates. All CLI calls explicitly named the scratch config and state root. No network gh call, real agent/model turn or real pane capture/read occurred. The source and tracked diff remain unchanged.

Install summary: `Lockfile is up to date, resolution step is skipped`; `Already up to date`; `HUSKY=0 skip install`; `Done in 1.1s`. The existing permanent pnpm store was used from the start, so deleting fake HOME leaves no dependency link into scratch. `node_modules/.modules.yaml` names `/home/taisung/.local/share/pnpm/store/v3`.

Own-process checks: every recorded node/test/replay PID is gone: **[]**. A broader `/proc` command/cwd scan for validation helpers, excluding the audit and its ancestors, is also **[]**. Gate helpers exited normally. Replay processes were terminated by exact owned PID:

```text
keeper and stub PIDs: [1940028, 1940033, 1940106, 1942819, 1942867, 1942967, 1943283, 1943438, 1946172, 1946425, 1947054]
private replay server PID: 1940027
aogm-gates-ao56: exit 1; no server running on /tmp/tmux-44402/aogm-gates-ao56
aogm-live-ao56: exit 1; no server running on /tmp/tmux-44402/aogm-live-ao56
```

The private server probes report no server; their stale owned socket files were removed. No pattern kill, no real lifecycle-worker stop, and no action against the protected sessions/watchers. Workers 1294181 and 1294364 were not touched.

Required final state audit:

```text
$ find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aogm-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55

```

Every returned entry:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions 2026-10-22 07:40:09.330289776 -0400
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55 2026-10-22 07:40:09.330289776 -0400
generation=46
status=working
createdAt=2026-10-21T18:11:33.442Z
```

- `sessions/ao-55`: an update of the existing protected worker, generation 46/status working. This predates this validation's first CLI replay. The replay CLI uses only its explicit scratch state/config, and the gates use fake HOME/scratch test roots. The exact external writer (hook/lifecycle/orchestrator read repair) is not identifiable from this record alone; no validation command targeted it.
- `sessions`: directory mtime equals that record's replacement time, consistent with the same external update.

`ls -la --time-style=full-iso ~/.ao/bin`, before and after, byte-identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

No source code change, worktree commit, rebase, pull, push, PR or primary rebuild. Only this validation report and `.agent_report.md` were produced in the worktree, beside the supplied task file. The prior reports are retained below the new status report.

Cleanup completed: `/tmp/aogm` and `/tmp/aogm-marker` removed, both owned private sockets removed. Final `.agent_report.md` published by atomic rename after the body was drafted and cleanup completed.
