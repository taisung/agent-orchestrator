# Herdr fit-1 code review r1 (Muse Spark 1.3) — `389b8dfe..9d51982b` (ao-73)

**Verdict: LAND-SAFE** — fit-1 (F-1, F-2, F-5, F-6, the interim startup guard, docs, Note-1 revert) is correctly implemented, fully tested for its scope, and green on every gate. No blocking (B) or major (M) findings. Six minor (m) findings below: none blocks landing; m-4/m-5 are owned by fit-2's full guard G, m-6 is a fit-2 docs carry.

## 0. Isolation and method

- `touch /tmp/aof1rm-marker` done at start. `ls -la --time-style=full-iso ~/.ao/bin` at start: the same 4 entries as review r7 quoted (`.ao-version`, `ao-metadata-helper.sh`, `gh`, `git`; same sizes/permissions/mtimes 2026-10-16 12:16); byte-equal again at end (section 8).
- Scratch env `/tmp/aof1rm/scratch`: link-only PATH (node 25.7.0, cached pnpm 9.15.4, git, tmux, gh-stub answering only `--version`/`auth status`, python3, gitleaks, coreutils + tee/mktemp added after the GH_WRAPPER diagnosis in section 5). Never `/usr/bin` itself on PATH. No agent binary, no herdr, no ao on test PATH. Every pnpm/node/test under `env -i HOME=/tmp/aof1rm/home TMPDIR=/tmp/aof1rm/tmp PATH=/tmp/aof1rm/scratch CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`. Initial `pnpm install --frozen-lockfile --offline` needed `--store-dir ~/.local/share/pnpm/store/v3` (config `store-dir` is unset in the scratch HOME); then from the store, offline.
- Rules observed: no push/PR/commit/network/`gh` network call, no `ao` against the real state root or real config, no real agent/herdr/model/tmux-server. tmux never invoked at all (no private server to clean). No `opencode` command. No pane reads. Mutations only in scratch copies (`/tmp/aof1rm/mut` from `git archive 9d51982b`).
- Read in brief order: spec r7 (§§0–3, 4.1–4.4, 4.6, 5.1, 5.2, 5.5, 5.6, 6–9) + review r7 (m-1, m-3 drive fit-1) → implementer brief + Note 1 → R4 rows 8/9 + `isProcessRunning` contract → full diff + callers + fixtures → implementer's report (after own reading).

## 1. F-1: the 0.9.5 failure form — correct

`packages/core/src/herdr.ts:91-112` (`readHerdrCliFailure`): numeric `code` 1, no signal, `killed !== true`, stdout exactly `""`, stderr exactly one line (one trailing `\n` stripped, then reject on any `\n`/`\r`), JSON object with exactly keys `id`+`error`, `id === expectedId`, `error` exactly `code` (non-empty text) + `message` (text). Each clause matches a T-1.4 near-miss (stdout text, two lines, exit 2/signal/killed, wrong/empty id, extra key, empty code, non-text message, Rust EACCES text, JSON list, null error). Verified the fixtures: `noserver_never_pane_get` (exit 1, empty stdout, `{"id":"cli:pane:get","error":{"code":"server_not_found…"}}`) and `closedpane_pane_get` (exit 1, `error` before `id` — key order independent since parsed) are the accepted forms.
- `cliIdOf` (`runtime-herdr/src/index.ts`) derives the expected id from the first two CLI words via `HERDR_CLI_IDS`; calls outside the table (`status server`, `agent attach`) get `""` → no F1 reading. Correct: no other AO call's failure is classified.
- `isHerdrNoServer` (`herdr.ts:122`): `server_not_running` + `startsWith("no herdr server is running at ")`. The fake-server form (`r5_b_pane_get_server_not_running_from_server`, "fake server says so") is F1 (keeps `herdrCode`) but not no-server. Correct per §3.1.
- Top-level `code`: core row 8 (`herdrCannotAnswer`, `herdr.ts`) and runtime row 9 (`getPaneStrict` wrapper) both copy `RUNTIME_NO_SERVER_ERROR_CODE` to the wrapper's own top level; `herdrCode` stays on the cause for row 9. Lifecycle (`isNoServerRejection`) and startup read `err.code` — wired correctly.
- 0.8.0 exit-0 envelopes untouched (`parseHerdrResult` unchanged; T-1.5 controls pass).
- R4 rows 8/9 in `docs/DEVELOPMENT.md` reproduce the exact form, grammar, empty-ID rule, near-miss and pin rules. `CLAUDE.md:431` and `types.ts` contract text match the behavior.

## 2. F-2: pane ID grammar — correct

`HERDR_PANE_ID_RE = /^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$/` (`herdr.ts:129`) excludes I/L/O/U exactly, requires lowercase `w`/`p`, no spaces/newlines. Verified in the scratch env with Node 25.7.0: `w1:p1` true; `w1:p1\n`, `\r`, `\r\n`, U+2028 suffix false (JS `$` without `m` is strict here — confirms r7 review's rejected-audit-candidate); `w0:p1`, `w11:p13`, `w1P:pZ`, `w1R:p1`, `w4:p0` true (measured rollover); `aohd-1`, `w1m:p1`, `wI:p1`, `w1:pL`, `W1:p1`, `w1:p1 ` false.
- Every pane call gates before any exec: core row 8 (`[]` for empty, throw for non-empty outside grammar), runtime `isAlive`/`sendMessage` (throw), `getOutput` (`""`), `create` root-pane check (today's "no usable pane"), attach (exit 1, no spawn). Zero-call assertions in T-2.1 hold.
- Agents keep `&& handle.id`: empty-ID fallbacks unchanged (codex/gemini/opencode false-paths, claude rejection) — brief point 1 and r7 m-3 honored. Verified at `agent-codex/src/index.ts:581`, `agent-gemini/src/index.ts:194`, `agent-opencode/src/index.ts:1340/661`, `agent-claude-code/src/index.ts:617`.

## 3. F-6: pins — correct

- `resolveHerdrEndpoint` (`herdr.ts:253`): absolute `binPath` normalized + must be executable regular file; bare name searched in absolute `PATH` entries in order, symlinks kept; relative-with-slash refused; `status server --json` (10 s) must be JSON with boolean `running` + absolute, control-free `socket`. Failure messages name the cause. `herdrInvocationFor` (`herdr.ts:295`): both pins → `{bin: herdrBin, env: {...process.env, HERDR_SOCKET_PATH: herdrSocket}}`; neither (legacy) → `{bin: legacyBin, env: undefined}`; anything else (one pin, relative, control char, non-string) → `HerdrPinError` (`ERR_HERDR_PIN`) before any call. `isPinPath` rejects C0/DEL/C1.
- Precedence is right: pin's `HERDR_SOCKET_PATH` overrides the caller's env; AO never passes `--session`, so per §3.2 the socket path decides. A PATH-only caller change cannot redirect a pinned launch (T-6.2/T-6.3).
- Every later call uses pins: runtime-herdr (`herdrStdout`/`herdr`/`herdrResult`/`readPane`/`getPane`/`waitForSettledAgent`/`promptWasConsumed` all take the invocation; `create` resolves first and stores `herdrBin`/`herdrSocket`), core rows 8/9 (handle overload; string keeps legacy ambient call), all four agents + opencode's second reader (pass the handle), attach (spawns `invocation.bin` with pin env; legacy keeps bare `herdr` + inherited stdio; malformed → exit 1, no spawn). Malformed-pin matrix verified in code: `isAlive`/`sendMessage`/rows 8/9 reject with zero calls; `getOutput` returns `""` with zero calls.
- T-6.8 legacy oracle preserved (spawn `herdr`, `{stdio:"inherit"}`); T-6.9/T-6.10 pass handles with pins.

## 4. F-5: destroy refuses — correct

`runtime-herdr/src/index.ts` `destroy` throws the stated refusal with zero `execFile`/`execFileSync` calls (all three old oracles migrated + T-5.1; message asserted verbatim in `index.test.ts:213-215`). Core never calls `destroy` for a runtime with `stop` (`stopRuntime` path unchanged). `same-id-defects-r2.test.ts` N-1 is now a plain passing test; the unused `defect` helper removed. Red-set: runtime-herdr 0 failing (section 5).

## 5. Interim startup guard — correct for its predicate; gaps named

Implemented in `core/.../session-manager.ts:571-603` (`isOrchestratorRuntimeAlive`: Herdr `false` and no-server → throw today's unknown error) and `cli/.../start.ts:887-976` (`hasStoredHandle`, `recordRuntimeName`, `isHerdrProbeTerminal`, `checkOrchestratorLiveness` Herdr branches + candidate filter + alive-terminal pass-over). Verified:
- Project mode (core): Herdr false/no-server throws → neither reuse nor archive/delete; tmux unchanged (false/no-server → gone). Isolated mode (CLI): `isHerdrProbeTerminal` pulls persisted-`killed`/enriched-terminal Herdr records into the check; unknown → exit 1 with today's refusal, no `spawnOrchestrator`, record byte-equal (composed `start-herdr-interim` tests assert sessions-dir listing equality and `workspace.create` not called).
- The killed-alive pass-over, `done`-record skip, and tmux controls are today's rules, kept deliberately (tests pin them).
- Cross-runtime change is safe by accident of classification: CLI resolves the persisted runtime (`recordRuntimeName` → `registry.get("runtime", "herdr")`), so an old Herdr record is probed by the Herdr plugin even after the project moves to tmux; core classifies by `handle.runtimeName`, so a tmux probe's `false` of a Herdr id still throws unknown instead of archiving. See m-2.

Gaps the guard misses (required to name; all are today's-rule residuals or fit-2 G scope, none regresses fit-1):
1. **Direct core `spawnOrchestrator` in isolated mode** reads no old records (`session-manager.ts:2618-2626`); only CLI holds Herdr records there. A direct core caller starts a numbered orchestrator next to a live old Herdr launch. Admitted in the implementer's report §3.
2. **Handleless records** (reservation/in-flight create, no stored handle) are `unchecked` in CLI and unselected by any guard — the r7 M-1 class. A second starter passes over them.
3. **Persisted-terminal records other than `killed`** (`done`/`merged`/`errored`) are never probed by CLI; in isolated mode a live Herdr pane under a `done` record gets a new neighbor orchestrator (project mode is safer: core reads the raw record and probes it).
4. **A `killed` Herdr record whose pane answers alive** is passed over and a new orchestrator starts (isolated mode: second orchestrator next to the live one). Today's terminal rule + admitted open question 2 of the implementer's report; fit-2 G decides.
5. Core probes an old Herdr handle through the **newly configured runtime plugin** (`plugins.runtime`); only the `handle.runtimeName` classification keeps it safe. A tmux session literally named `w3:p2` answering `true` would reuse a Herdr record on tmux evidence (m-2).

## 6. No regression

- Lifecycle: T-1.6 (F1 `pane_not_found` → `killed` after two polls, as the 0.8.0 control) and T-1.7 (no-server probe outcome, below `NO_SERVER_BOUND_MS`, then `killed (runtime)`) pass in `lifecycle-pane-envelope.test.ts`. tmux lifecycle untouched.
- `core/src/index.ts`: additions only (old herdr exports retained; diff shows zero removed lines).
- `isProcessRunning` contract (CLAUDE.md:431): core helper rejects when herdr cannot answer or the answer is malformed; agents map rejection to unknown. The empty-Herdr-ID agent fallbacks are unchanged per brief point 1.
- Oracle migrations enumerated by the implementer (§2 of their report) match the diff: create call indices +1 (status first), `fs` mock `importOriginal`, attach legacy oracle (`w2:p1`), opencode `objectContaining` handles, three destroy oracles + N-1/control. Each is behavior-faithful.
- W-5a cleanup (`workspace close` on pane-run failure) is **retained** in `create` — intentional: F-4 is fit-2 scope (report §4). Not a regression, noted for fit-2.

## 7. Note 1 — format-neutral, verified independently

For all five files, `e322e338:file` vs `HEAD:file` with whitespace+commas stripped are byte-identical (re-ran the token check myself; opencode `index.ts` differs only by the restored missing EOF newline). `git diff -w --ignore-blank-lines` lines are all line-join/split + trailing-comma reflows; sampled hunks (`parseJsonlFileTail`, `extractSummary`, codex getters, opencode tests) change no string content — changed quote-bearing lines are the same literals re-wrapped (regexes, option objects). `git diff 389b8dfe HEAD -- <five files>` holds only fit-1 behavior/test hunks. Pre-commit hook evidence (gitleaks clean on all 5 commits) is in section 5.

## 8. Findings (new IDs; all minor)

- **m-1 (test gap: no-server prefix position not pinned).** `isHerdrNoServer` requires `startsWith(prefix)` — correct per spec — but no test pins the position. Ran a mutant in a scratch copy (`git archive 9d51982b` + symlinked node_modules): `startsWith` → `includes`. All 104 core `herdr.test.ts` and 66 runtime-herdr `fit-reads`/`fit-pins`/`fit-startup-interim` tests still pass, while a wrapped message (`"herdr relay: no herdr server is running at /tmp/x (proxied)"`) now maps to no-server (reproducer via built `dist`: mutant `true`, tip `false`). Recommend a T-1.4-style near-miss: prefix not at offset 0 rejects the no-server code (keeps `herdrCode`).
- **m-2 (core cross-runtime dispatch).** `isOrchestratorRuntimeAlive(plugins.runtime /* newly configured */, oldHerdrHandle)` probes a Herdr pane through the tmux plugin after a runtime change; only the `handle.runtimeName` classification prevents an archive. If a tmux session were ever named `w3:p2` (tmux names are free-form), `true` would reuse a Herdr record on foreign evidence. CLI does not share this flaw (probes via the recorded runtime). Recommend fit-2 G dispatch through `registry.get("runtime", handle.runtimeName)` (r7 M-3).
- **m-3 (CLI reuses `unchecked` handleless orchestrators).** `existingOrchestrators` includes `unchecked` (no stored handle) without any probe — an in-flight Herdr create's reservation can be "reused" sight unseen. Today's rule for all runtimes; fit-2 admission work should cover it (r7 M-1).
- **m-4 (isolated-mode `done`/other-terminal Herdr records unprobed).** `isHerdrProbeTerminal` covers only missing/non-terminal/`killed` persisted status; a live pane under a `done` record gets a new isolated neighbor. Named residual; fit-2 G selects regardless of status.
- **m-5 (killed-alive pass-over starts a neighbor in isolated mode).** Pinned by test (`start.test.ts:1342` expects `spawnOrchestrator` called); in isolated core this becomes a second orchestrator next to the live launch. Admitted in the implementer's open question 2; fit-2 G2 decides reuse vs block.
- **m-6 (stale `lifecycle-manager.ts:214-222` comment kept).** Still says codex/gemini/opencode `isProcessRunning` and runtime-herdr `isAlive` "answer false on an error"; since R4 (and this fit) the core Herdr helpers reject when they cannot answer. Design §5.8 listed this comment for update; the implementer skipped the file as outside the allowed list (their §4). Comment-only; carry to fit-2 docs.

## 9. What was found correct (spot summary)

F1 exact-form reader + all near-miss rejections; no-server mapping + top-level `code` on both wrappers; 0.8.0 controls; pane grammar (measured alphabet + rollover, strict `$`) with zero-call gates on every path incl. attach; pins (binary resolution rules, socket validation, invocation routing, malformed→zero-call matrix, legacy passthrough); all four agents + both opencode readers passing handles with fallbacks unchanged; destroy refusal verbatim + N-1 leaving red; interim guard refusing (not retiring) on Herdr false/no-server in project + isolated CLI paths with byte-equal records; tmux behavior identical everywhere; public API additions-only; R4/CLAUDE/types docs matching the code.

## 10. Gates on `9d51982b` (scratch env, `HUSKY=0`, `NPM_CONFIG_OFFLINE=true`)

- `pnpm install --frozen-lockfile --offline --store-dir ~/.local/share/pnpm/store/v3`: ok (note: bare `--offline` misses `@clack/prompts` tarball without the explicit store dir; with it, done).
- `pnpm build`: 0. `pnpm typecheck`: 0. `pnpm lint`: 0 errors, exactly the 5 known warnings (`spawn.ts:333`, `activity-log.ts:91`, `plugin-registry.ts:232`, `session-manager.ts:2402,2409` — the two `no-console` lines moved by commit 1's +19 lines).
- Full `pnpm -r --no-bail test` (no agent binary, no herdr on PATH): **all packages pass, RC=0** — core 1695 passed + 1 expected fail; runtime-herdr 143; cli 409; claude-code 319; codex 308; gemini 89; opencode 365; runtime-tmux 69; workspace-worktree 85; notifier 26; scm-github 140 + 5 skipped; tracker-github 42; integration 91 passed + 24 skipped. Matches the implementer's counts except integration (they report 69+46; here 91+24): the 22 extra passes are tmux-gated integration tests that execute because the scratch PATH links a real tmux (their env skipped them). Skips here are agent-binary-gated (claude 10, codex 5, prompt-delivery 4, opencode-live 5). One initial scare — 4 `agent-workspace-hooks GH_WRAPPER` failures — was my scratch PATH missing `tee`/`mktemp` (wrapper pipes through `tee`+`mktemp`); after adding those links the file is 77/77 green, also with the gh stub present.
- `SAME_ID_DEFECTS=red pnpm -r --no-bail test` (nonzero exit expected): core 1 (R3 F-5), gemini/codex/claude-code 1 each (R2 D-B), opencode 2 (R2 D-B, R3 F-3), runtime-tmux 11 (R2 B-1×4, B-2, B-5×2, D-B×2, F-5, F-7), workspace-worktree 4 (R3 F-1, F-2×2, F-5), runtime-herdr **0** (N-1 left the set ✓), cli/integration clean. Totals **R2 15, R3 6** — exactly the expected set minus N-1.
- `gitleaks git --log-opts=389b8dfe..9d51982b --redact`: 5 commits scanned, no leaks.
- Per-commit green was evidenced in the implementer's report (D3 table) and not re-run here; tip gates above + the Note-1 token check cover the revert commit.

## 11. Landing readiness (read-only; no ref written)

- `git merge-tree --write-tree main 9d51982b`: clean single tree `e6551b1b…`, no conflicts.
- `git merge-tree --write-tree feat/session-relaunch 9d51982b`: 4 conflicting paths — `docs/DEVELOPMENT.md`, `packages/cli/src/commands/start.ts`, `packages/cli/__tests__/commands/start.test.ts`, `packages/core/src/session-manager.ts`. Expected: that branch also touches `isProcessRunning` (tmux branches) and the same startup/table areas; Note 1 already shrank the agent-file overlap to fit-1 hunks only. Merge will need a human pass over those four files; nothing in fit-1 makes it worse than the design anticipated.

## 12. Cleanup evidence

- My processes: none remain (scanned `/proc/*/environ` for `HOME=/tmp/aof1rm/home` — empty; the two background `pnpm -r` runs completed and were notified). The real lifecycle workers 4027448/4027591 untouched and still running. No `pkill`/pattern kill used.
- tmux: never invoked (no default-server command, no private server); nothing to clean.
- `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof1rm-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'` printed only other actors' paths (Nexus project sessions, ao-74/ao-75 spawns, ao-65/ao-orchestrator lifecycle updates, archive/generations dirs) — none contain `aof1rm`, none written by this review (no `ao` command ran; all tests used `HOME=/tmp/aof1rm/home` temp roots).
- `~/.ao/bin` before and after: byte-equal (`.ao-version`, `ao-metadata-helper.sh`, `gh`, `git`; same sizes/permissions/mtimes as §0).
- `/tmp/aof1rm` (scratch HOME, scratch PATHs, `mut` copy, tails, marker) removed at the end; `git status --short` in the worktree shows only the three untracked paths: `.agent_task.md` (supplied), `.agent_report.md` (required), `development/reviews/herdr_fit1_code_review_r1_muse13.md` (this file). `git diff --exit-code -- packages docs .github` passes (no tracked modifications).
