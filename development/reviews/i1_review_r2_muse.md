# Review R2: I-1 drop OpenCode 1.x, require 2.0.29 (`8241f54c..39549455`) (reviewer: Muse)

**Verdict: LAND-SAFE**

No blocker, no major. Round 1's B-1, M-1 and M-2 are closed with evidence, the restore
reorder is safe for every agent, the version table matches Q9 on every row with a distinct
refusal reason, and the new tests are non-vacuous (12 plugin + 4 core tests fail against the
round-1 sources). Three new minors (m-10, m-11, m-12), all cosmetic or bounded, none blocking.
The author's report checks out: every D-claim I re-ran reproduced within noise.

Reviewed at `39549455` (`git log --oneline -1` matches). Host: Linux, Node v25.7.0, real
`opencode v2.0.29` at `/home/taisung/.opencode/bin/opencode`. I formed items 1-4 before
reading the author report at `ao-1/.agent_report.md`.

## Findings

### B-1 (round 1 blocker): CLOSED — integration suite is hermetic, CI `Test` passes with no OpenCode

- Fix: `agent-opencode.integration.test.ts` writes a fake `opencode` (`opencode v2.0.29`) in
  `beforeAll`, prepends it to PATH, restores PATH in `afterAll`; plus a new 3-test
  `version gate (integration)` block that runs with only a fake dir on PATH.
- Evidence (this worktree's build):
  - File, hidden (`PATH=$NODE_BIN:/usr/bin:/bin`): `Tests 26 passed | 5 skipped (31)`.
  - File, real 2.0.29: `Tests 31 passed (31)`.
  - Package, hidden: `Test Files 11 passed | 2 skipped (13)`, `Tests 99 passed | 20 skipped (119)`, exit 0.
  - Package, real: `Tests 104 passed | 15 skipped (119)`, exit 0.
- No hidden coverage: module-level detection runs at import with the original PATH, before
  `beforeAll` swaps it, so the gated live lifecycle block still runs iff the real binary is
  present (the 5-file skips hidden vs 0 are that block; package delta 99|20 vs 104|15 is the
  same 5). The fake feeds only pure string/probe assertions.
- `.github/workflows/ci.yml` `Test` job installs no OpenCode and runs `pnpm test`: now green.
  `integration-tests.yml` installs `npm install -g @opencode/cli` unpinned (the round-1
  reviews' `opencode-ai 1.19.0` line is stale, as the author notes); the suite passes with any
  version now, since the launch block no longer reads the host binary.

### M-1 (round 1 major): CLOSED — refused orchestrator spawn leaves no worktree, metadata or prompt file

- Fix: `5a7f9591` wraps `getLaunchCommand` + `getEnvironment` in `spawnOrchestrator` in a `try`
  whose `catch` calls `cleanupOrchestratorMetadataAndWorkspace(systemPromptFile)` and rethrows.
- Evidence (isolated `AO_STATE_ROOT`, scratch repo/config, fake `1.18.35` first on PATH,
  `sm.spawnOrchestrator` via the built CLI registry): `THREW: ao needs OpenCode 2.0.29 or
  later (found 1.18.35)`; sessions dir holds no reservation (only `.origin`); no
  `orchestrator-prompt-*` file; `git worktree list` shows only the repo; `ao session ls`
  shows no phantom `[spawning]` row (round 1 left one per failed `ao start`).
- Branch: `orchestrator/zzrmuse-orchestrator-1` REMAINS (deleted in cleanup). Same known class
  as m-7: the worktree plugin never deletes branches on any cleanup path. Record-only per the
  brief; out of scope for this increment.

### Restore reorder (`04a879e5`): SAFE for every agent, refused restore keeps the old pane

- Core now resolves `getRestoreCommand` (or fallback `getLaunchCommand`) + `getEnvironment`
  before `runtime.destroy`. Pre-destroy calls per agent are side-effect free:
  - claude-code `getRestoreCommand`: reads `~/.claude/projects/...` JSONL names, builds a string.
  - codex: reads/caches the session rollout file, builds a string. gemini: `readdir` of the tmp
    dir, builds a string. opencode: metadata ID or `findOpenCodeSession` (read-only `session
    list`), then a pure string builder. All `getEnvironment`/`getLaunchCommand` are pure string
    builders (opencode's probe is a read-only `execFileSync`, no writes/locks).
  - Nothing depends on the old runtime being gone; nothing writes files or takes a lock.
- Evidence (killed session, live tmux pane on isolated server, fake `1.18.35`):
  `THREW: Error: ao needs OpenCode 2.0.29 or later (found 1.18.35)`; `tmux ls` shows the pane
  before and after; metadata `status=killed` unchanged. (Round 1 destroyed the pane first.)
- Core restore tests pass (643/643); the 3 new refusal/order tests fail on round-1 core (item 7).

### M-2 (round 1 major): CLOSED — 10 s bound, named timeout, stderr discarded

- Fix: `8812be19` probes with `{ timeout: 10_000, killSignal: "SIGKILL", stdio: ["ignore",
  "pipe", "ignore"] }`. A nonzero exit / signal / spawn error each gets its own refusal reason.
- Evidence: `detect()` with hanging fake 10003 ms → false; `ao spawn` 10.75 s →
  `... (opencode --version gave no answer within 10 s)`; direct `getLaunchCommand` 10013 ms,
  same message. Stderr-capture run: child's stderr never reaches the terminal (empty stderr file).
- Judgment on the ~40 s hanging restore (author's point 2, reproduced: 40.25 s with a LIVE pane,
  pane survives, version named): 30 s is the pre-existing `findOpenCodeSession` (`timeout:
  30_000`) inside `getActivityState` during restore enrichment, + 10 s gate. Bounded, and only
  on a hanging binary; an ordinarily refused host fails in ~0.3 s (author) / ms here. Acceptable
  for this increment; follow-up can lower that discovery timeout or skip the activity probe on
  restore (m-12).

### Item 5: version table (built plugin, fake first on PATH) — all rows fit Q9 (minimum of 2.0.29)

| `opencode --version` | `detect()` / launch | fits Q9 |
|---|---|---|
| `1.18.35` | false / `(found 1.18.35)` | yes, refused |
| `opencode v2.0.28` | false / `(found opencode v2.0.28)` | yes |
| `opencode v2.0.29` | true / ok | yes, floor accepted |
| `2.0.29-beta.1` | false / `(found 2.0.29-beta.1)` | yes: pre-release of the floor precedes it (semver) |
| `2.0.30`, `2.1.0`, `10.0.0`, `opencode v2.1.0 (abc123)` | true / ok | yes, minimum not pin |
| `2.1.0-beta.1` | true / ok | yes, past the floor |
| `opencode dev` | false / `(found opencode dev)` | yes |
| empty output | false / `(opencode --version printed nothing)` | yes, distinct from missing |
| exit 3 + valid version on stdout | false / `(exited with status 3, output: opencode v2.0.29)` | yes: a failing `--version` is not a working binary (round-1 m-2 fixed) |
| missing binary | false / `(opencode not found on PATH)` | yes, distinct |
| hang | false after 10.0 s / timeout reason | yes, bounded |
| `update available 1.2.3` + `opencode v2.0.29` | true / ok | yes: notice line can't decide (round-1 m-3 fixed, line-anchored) |
| `update available 1.2.3` alone | false / refused | yes |

Every refusal starts `ao needs OpenCode 2.0.29 or later (...)`. Multi-line output is joined
` | ` and cut at 80 chars (one-line message). `detect()` hides OpenCode on every refusal (Q6).

### Item 6: no regression, no 1.x text

- Round-2 hunks in `index.ts` touch only the gate block, `getRestoreCommand` probe placement
  and `detect()`; `getLaunchCommand` and all command builders (`session.create` body,
  `session.get` readback, `switchModel`/`switchAgent`, TUI open) have zero diff lines, so the
  2.x new-session/resume/restore commands are byte-identical to round 1 by construction (round 1
  proved round-1 == baseline 2.x branch; author re-hashed 18/18 identical).
- Round-1 grep pattern prints nothing (exit 1). Only remaining `1.x` mention is a comment
  documenting the `1.18.35` refusal format. Kept for I-2/I-4: `parseUpdatedTimestamp`,
  `parseSessionList`, `findOpenCodeSession`.

### Item 7: tests non-vacuous, relations not copies

- New unit tests vs round-1 `index.ts` (scratch copy): `12 failed | 147 passed (159)` — the 12
  are exactly the new gate behaviors (notice line, `2.0.29-beta.1`, non-leading version,
  printed-nothing, not-on-PATH, bound, exit status, signal, EACCES, stderr/timeout options,
  one-line message, probe left to launch fallback).
- New core tests vs round-1 `session-manager.ts` (scratch copy): `4 failed | 100 passed` —
  exactly the 4 new tests (3 restore refusal/order + 1 orchestrator refusal cleanup).
- Relations: probe-count assertions (`execFileSync` ran N times), message-reason assertions,
  exact resume-command assertion for the existing-ID path (`39549455` pins it), and shell-run
  API-body comparisons — not source-literal copies. The m-5 misnamed test is replaced by the
  probe test that asserts both paths' commands.

### m-10 (minor, new): CLI `ao spawn` against a hanging binary can leave a `status=killed` stub (race)

- `ao spawn` starts the lifecycle worker before spawning (`ensureLifecycleWorker`). During the
  new 10 s probe window the worker can poll the reserved-but-empty ID and mark it killed.
  Observed 1 of 2 identical hanging-spawn runs: sessions dir held `zzrmuse-2` with exactly
  `status=killed`; the rerun left nothing. Direct `sm.spawn` without a worker never leaves it.
- Cosmetic: no worktree/pane leak (worktree destroyed, branch only per m-7), stub is a terminal
  status removable by cleanup. Pre-existing worker behavior, newly exposed by the 10 s window.
  Reproducer: CLI `ao spawn` with `sleep`-fake first on PATH, twice; inspect
  `$AO_STATE_ROOT/*/sessions/`.

### m-11 (minor, author's point 3 confirmed): refused binary + no stored session ID restores with an unversioned message

- `restore` core discovery runs the refused binary, gets no mapping, throws
  `SessionNotRestorableError: ... OpenCode session mapping is missing` before the plugin gate.
  Reproduced (fake `1.18.35`, metadata without `opencodeSessionId`); the pane is kept either way.
- Accurate (the mapping IS missing) but doesn't name the version problem. Minor.

### m-12 (minor, author's point 2): hanging-binary restore with a live pane takes ~40 s

- 30 s pre-existing `session list` discovery in restore enrichment + 10 s gate, both bounded.
  Normal refused hosts fail fast. Acceptable; follow-up can lower the discovery timeout.

### Item 8: author's open points — severity only

- Unversioned no-mapping message (point 3): minor (m-11).
- Leftover branch after refused spawn (m-7, point 5): record-only; reproduced for worker
  (`feat/stub-repro`), orchestrator (`orchestrator/zzrmuse-orchestrator-1`) and direct spawn
  (`session/zzrmuse-2`); all removed in cleanup. Workspace-plugin semantics, unchanged on every
  cleanup path, not I-1 specific.
- PATH split gate-vs-pane (m-9): record-only; single `opencode` on this host so Node and pane
  agree; author's I-6 note stands.

### Item 9: scope and hygiene

- 6 files, all in the allowed list; 5 conventional commits with WHY bodies, no
  `Co-Authored-By`, no emoji, no issue number; `git diff --check` clean;
  `git branch -r --contains 39549455` prints nothing. Nothing committed or pushed by me;
  `git status` shows only the untracked `.agent_task.md`.

### Commands (this worktree, quoted summary lines)

- `pnpm install --frozen-lockfile`: ok. `pnpm build`: ok (all packages).
- Plugin test: `Test Files 1 passed (1)`, `Tests 159 passed (159)`. Plugin typecheck: exit 0.
- Core test: `Test Files 31 passed (31)`, `Tests 643 passed (643)`.
- Integration hidden: `Tests 99 passed | 20 skipped (119)`; present: `104 passed | 15 skipped`.
- `pnpm typecheck` (all): exit 0. `pnpm lint`: `6 problems (0 errors, 6 warnings)` (pre-existing;
  the `index.ts:433` non-null warning is outside the diff).
- `pnpm test` (full): per-package all green (core 643, cli 243, agent-opencode 159,
  integration 104|15, others as author's table), exit 0.

## Checked and found correct (round-1 findings closed)

- B-1: suite hermetic; CI `Test` green without OpenCode; no coverage hidden by the fake.
- M-1: refused orchestrator spawn leaves no worktree, metadata or prompt file; no phantom row.
- M-2: 10 s SIGKILL bound on `detect`, spawn and restore; stderr discarded.
- Restore reorder keeps the surviving pane on refusal, for every agent's read-only pre-destroy calls.
- One probe per restore (ID path probes in `getRestoreCommand`, no-ID path defers to the
  `getLaunchCommand` fallback); floor text derived from one triple; m-5 test replaced.
- Live 2.0.29 spawn opens the TUI on `AO:zzrmuse-1` (agent worked, committed on
  `feat/say-hi`); session `ses_ec24a1af6ffex7MjY2JBJxPAMw` removed afterwards, store verified empty.
- Only the six files changed; hygiene rules met; nothing on any remote.

## Reproducers

- B-1: `PATH=$NODE_BIN:/usr/bin:/bin pnpm --filter @aoagents/ao-integration-tests test`
  (hidden: 99|20) vs normal PATH (104|15).
- M-1: scratch config + `sm.spawnOrchestrator` with `1.18.35` fake; inspect state dir,
  `git worktree list`, `git branch --list 'orchestrator/*'`.
- Reorder: fabricated killed session + live isolated pane + fake `1.18.35` → `sm.restore`;
  `tmux ls` before/after.
- M-2: `sleep`-fake; time `detect()`, CLI `ao spawn`, `sm.restore` (live pane: ~40 s).
- m-10: CLI `ao spawn` with `sleep`-fake twice; inspect sessions dir for a `status=killed` stub.
- Non-vacuity: scratch copies per item 7; failing test names listed above.
