LAND-WITH-CHANGES

# Herdr fit-2b code review r1 (Gemini 4 Argon) — 2026-10-23

Target range: `c6d80383..13f982c2` (`ao-73`, 4 commits on `c6d80383`). Verified `git log --oneline -1` prints `13f982c2 docs: the herdr fit-2 contracts`.

**Verdict: `LAND-WITH-CHANGES`** — **0 blocking (B), 4 major test-coverage findings (M-1 to M-4), 2 minor (m-1, m-2)**.
The product implementation in commits 5–8 follows the design specification (`development/reviews/herdr_fit2_design_r11_opus.md`, section 8.2) and passed all 7 adversarial ownership/admission probes added in scratch during this review. The 4 major findings are unguarded risky rules in items 1, 2, 3, and 6 where a partial fix or wrong mutant in `packages/core/src/session-manager.ts` builds cleanly and passes all 485 tests across the 16 new/changed test files (per section 5: *"M (major): a design rule of 8.2 that the code does not follow, or a risky rule that no test guards"*). All gates (`pnpm install --frozen-lockfile --offline`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, full `pnpm -r --no-bail test` with private-tmux shim, `SAME_ID_DEFECTS=red` = 21, the 15 relaunch test files, `gitleaks`, and `git merge-tree`) pass.

---

## 1. Isolation and initial receipts

At the start of the review, created `/tmp/aof2ba-marker` and recorded `ls -la --time-style=full-iso ~/.ao/bin` (`/tmp/aof2ba/evidence/ao_bin_start.txt`):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Commit range (`git log --reverse --oneline c6d80383..13f982c2`, `/tmp/aof2ba/evidence/git_commits.txt`):

```text
256b29f0 fix: admit at most one herdr orchestrator launch per project
960dab87 fix: ao start and ao spawn follow the core admission
3b740805 feat: retire a herdr record on the owner's word
13f982c2 docs: the herdr fit-2 contracts
```

Scratch copies were unpacked with `git archive 13f982c2 | tar -x -C /tmp/aof2ba/tip` and `git archive c6d80383 | tar -x -C /tmp/aof2ba/base`. All `pnpm`, `node`, and test runs executed under `env -i HOME=/tmp/aof2ba/home TMPDIR=/tmp/aof2ba/tmp PATH=/tmp/aof2ba/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`, where `/tmp/aof2ba/bin` contained only symlinks to required system tools, cached `pnpm` 9.15.4 (`~/.local/share/pnpm/.tools/pnpm/9.15.4/bin/pnpm`), a `gh` stub answering only `--version` and `auth status`, and a `tmux` shim unsetting `TMUX` and passing `-L aof2ba-tests` unless the first argument was `-S` or `-L`. No `/usr/bin`, no agent binary, and no `herdr` binary was on `PATH`.

---

## 2. Findings

### Blocking (`B`): none

No interleaving of two starts, a start and a restore, or a start and a spawn/kill/lifecycle write was found on `13f982c2` in which core or the CLI admits two Herdr orchestrator launches for one project, reuses a record owned by a live launcher, or reuses a `create-pending` (`P`) record, a kept failed launch, or a damaged handle. No F-9 path was found that retires a record whose launch runs or changed after the owner's check, or removes/closes a resource that the design keeps. No regression of `tmux` or other runtimes was found.

### Major (`M`)

#### M-1 — No test guards the post-`admissionLock` subject equality checks (`checkSubject`) under Lock A

- **Code:** `packages/core/src/session-manager.ts:3299-3320` (`checkSubject`), called at `:3379` (after `mkdirSync` in `start`), `:3383` (when `sessionsDir` exists in `restore` and `reuse-only`), `:3999`, `:4038`, `:4043` (before `reserveSessionRecord` in project mode), `:4112` (before `reserveNextOrchestratorIdentity` in isolated mode), `:6250` (before `reserveSessionRecord` in `copyBackArchive`), and `:6329` (before `updateMetadataIf` in `stopAndTransition`).
- **Design rule:** Section 4.9 ("Fixed for the operation") and section 5.3.1 require `realpathSync(sessionsDir) === subject` under A after `mkdir`, and again directly before the reservation (start), before the copy-back, and before the transition write (restore), refusing with `OrchestratorStartBlockedError` (`reason: "admission-path"`) and naming the empty directories that `mkdir` made when the real path changed.
- **Evidence:** `T-7.25b` (`packages/core/src/__tests__/session-manager/orchestrator-admission.test.ts:220-250`) fails inside `admissionLock()` before `runAdmission` reaches `stage("subject-fixed")` or acquires Lock A. In `/tmp/aof2ba/tip`, mutating `checkSubject` in `packages/core/src/session-manager.ts:3299` to a no-op (`const checkSubject = (made?: string): void => { if (made !== "__never__") return; ... }`), or keeping `checkSubject(made)` after `mkdir` while removing `checkSubject()` at `:4112` before the reservation, compiled cleanly (`pnpm --filter @aoagents/ao-core build` exit 0) and passed all 485 tests across all 16 changed test files (`/tmp/aof2ba/evidence/mutants_unguarded.txt`).
- **Reproducer (`/tmp/aof2ba/evidence/mutants_probes.txt`):** Append `REVIEW-1a` and `REVIEW-1b` below to `packages/plugins/runtime-herdr/src/__tests__/fit2-admission.test.ts`:
  - `REVIEW-1a` swaps the symlink `alias-state -> real1` to `real2` inside `onStage("subject-fixed")` (after `admissionLock` fixed `subject` under `real1`, before `mkdirSync` under Lock A). Unmodified `13f982c2` passes (`OrchestratorStartBlockedError`, `reason: "admission-path"`, message contains `"the empty directories that this start made stay"`, `workspaceCalls: []`); Mutant 1a fails (`2 failed | 36 skipped`).
  - `REVIEW-1b` swaps the symlink inside `onStage("before-reservation")` (after `mkdir` and G1/G2 under `real1`, directly before the reservation). Unmodified `13f982c2` passes; Mutant 1b (which keeps the post-`mkdir` check and omits the pre-reservation check) passes `REVIEW-1a` and fails `REVIEW-1b` (`1 failed | 1 passed | 36 skipped`).

#### M-2 — No test guards the reuse-candidate re-read after `setupWorkspaceHooks` in `spawnOrchestrator` or G1 row 4 (handleless record with a live launch owner)

- **Code:**
  1. `packages/core/src/session-manager.ts:4084-4105` (the strict re-read of `candidate`, token comparison `launchIdentityToken(current) !== candidate.record.token`, and re-judging `judgeOrchestratorRecord` after `await orchestratorAgent.setupWorkspaceHooks` in `spawnOrchestrator`).
  2. `packages/core/src/session-manager.ts:3075-3078` (G1 row 4 in `selectOrchestratorRecords`: `!byHandle && !raw["runtimeHandle"] && isLaunchEndUnproven(selectedRuntime)` with `owner !== null`).
- **Design rule:** Section 5.3.2 (and section 8 table row 5, *"the reuse re-read check (r10)"*): because `setupWorkspaceHooks` is awaited in the admitted step before returning a reused candidate, core must strictly re-read the record and verify that it still holds the deciding round's identity token and passes R1–R6; otherwise the round counts as a change (`{ kind: "next" }`). Section 5.3.3 row 4: G1 selects a record with no `runtimeHandle` and a live launch owner when the project's selected runtime is in the set (`in-progress`).
- **Evidence:** In `T-7.23` (`packages/plugins/runtime-herdr/src/__tests__/fit2-admission.test.ts:859-906`), the record is mutated inside `herdr.on["pane get"]` (between rounds, before `decide` and before `setupWorkspaceHooks`). In all in-progress tests (`T-7.20`, `T-7.21`, `T-7.26b`, `T-7.27`, `T-7.28`), the record already carries `runtimeHandle: PENDING`, which satisfies G1 row 1 (`byHandle === true`). In `/tmp/aof2ba/tip`:
  - **Mutant 2a:** Replacing lines `4088-4097` of `packages/core/src/session-manager.ts` with `const current = candidate.record.raw;` built cleanly and passed all 485 tests in the 16 changed test files.
  - **Mutant 2b:** Replacing line `3075` (`if (!byHandle && (raw["runtimeHandle"] || !isLaunchEndUnproven(selectedRuntime))) continue;`) with `if (!byHandle) continue;` built cleanly and passed all 485 tests in the 16 changed test files.
- **Reproducer (`/tmp/aof2ba/evidence/mutants_probes.txt`):** Append `REVIEW-2a` (in project mode with strategy `reuse` and a live pane, `setupWorkspaceHooks` writes `launchFailed` or a new `restoredAt` into `app-orchestrator`) and `REVIEW-2b` (an `app-orchestrator-1` record with `handle = null` and this process's live `launchPid`/`launchPidStart` on a Herdr project) to `fit2-admission.test.ts`. Unmodified `13f982c2` passes both (`[FIXED, "not-reused", "its launch failed"]` and `["app-orchestrator-1", "in-progress", ...]`); Mutant 2a fails `REVIEW-2a` (wrongly reuses the failed record) and Mutant 2b fails `REVIEW-2b` (launches a second orchestrator next to the live launcher).

#### M-3 — No test guards `findReusableOrchestrators` holding Lock A on Linux or its round-3 `exhausted` fallback

- **Code:** `packages/core/src/session-manager.ts:3368-3371` (`holdDeliveryLock` in `runAdmission` for `mode === "reuse-only"`) and `:4560-4578` (`exhausted: reusable` in `findReusableOrchestrators`).
- **Design rule:** Section 5.3.1 (*"Who takes it: `spawnOrchestrator` ...; `restore` of an orchestrator record ...; `findReusableOrchestrators`"*), section 5.3.2 (*"after round 3 with a record that still needs a probe: start, restore: throw records-changed; reuse-only: return the records that are reusable, drop the rest"*), and `packages/core/src/types.ts:1868-1873`.
- **Evidence:** `T-7.4` (`packages/cli/__tests__/commands/start.test.ts:596-625`) mocks `sm.findReusableOrchestrators.mockRejectedValue(...)`, and `T-7.26c` (`fit2-admission.test.ts:970`) calls `findReusableOrchestrators` only after Lock A has been released. `T-7.28` (`packages/cli/__tests__/commands/start-herdr-guard.test.ts:863-933`) mutates the record only once during `pane get`, so round 2 settles and `exhausted` is never reached. In `/tmp/aof2ba/tip`:
  - **Mutant 3a:** Skipping Lock A in `runAdmission` when `mode === "reuse-only"` (`supported && mode !== "reuse-only"`) built cleanly and passed all 485 tests in the 16 changed test files.
  - **Mutant 3b:** Removing `exhausted: reusable` from `findReusableOrchestrators` (so round 3 throws `records-changed` instead of returning reusable records and dropping the changing one) built cleanly and passed all 485 tests in the 16 changed test files.
- **Reproducer (`/tmp/aof2ba/evidence/mutants_probes.txt`):** Append `REVIEW-3a` (pause a start at `onStage("lock-held")` while calling `h.sm({ waitMs: 50 }).findReusableOrchestrators("my-app")`) and `REVIEW-3b` (two live isolated records `app-orchestrator-1` and `app-orchestrator-2` where `pane get` for `w4:p1` rewrites `app-orchestrator-2`'s `restoredAt` in all 3 rounds while `app-orchestrator-1` stays unchanged) to `fit2-admission.test.ts`. Unmodified `13f982c2` passes both (`REVIEW-3a` rejects with `admission-busy`; `REVIEW-3b` resolves to `["app-orchestrator-1"]`); Mutant 3a fails `REVIEW-3a` and Mutant 3b fails `REVIEW-3b` (rejects with `records-changed`).

#### M-4 — No test guards F-9 step 5 (`confirmRuntimeClosed` when the handle's runtime plugin is not loaded)

- **Code:** `packages/core/src/session-manager.ts:4815-4824` in `killRecord`.
- **Design rule:** Section 5.4.2 step 5: *"5. The handle's runtime plugin must be registered (4.6). Else refuse."*
- **Evidence:** `T-7.8d` (`packages/plugins/runtime-herdr/src/__tests__/fit2-startup.test.ts:434-447`) tests `sm.kill("app-1")` *without* `confirmRuntimeClosed` when `herdrLoaded: false`. All `T-9.1`–`T-9.13` tests run with the `herdr` runtime plugin registered. In `killRecord`, if line `4815` is mutated to `if (!runtimePlugin && isLaunchEndUnproven(handle.runtimeName) && retireToken === undefined)`, then when `confirmRuntimeClosed` is passed and `runtimePlugin` is `null`, `if (runtimePlugin)` at line `4824` is false: `killRecord` skips `stopRuntime` (step 6), skips `retireEvidence` (step 7), skips the conditional retire write (step 8), and proceeds directly to step 9 (destroying the worktree and archiving the record without retire keys). In `/tmp/aof2ba/tip`, this mutant (Mutant 4) built cleanly and passed all 485 tests in the 16 changed test files (`/tmp/aof2ba/evidence/mutants_unguarded.txt`).
- **Reproducer (`/tmp/aof2ba/evidence/mutants_probes.txt`):** Append `REVIEW-4` to `packages/plugins/runtime-herdr/src/__tests__/fit2-startup.test.ts` (`setup({ selects: "tmux", herdrLoaded: false })`, call `h.sm.kill("app-1", { confirmRuntimeClosed: token })`). Unmodified `13f982c2` passes (`RuntimeStopUnconfirmedError`, `"no runtime plugin herdr is loaded; record and worktree kept"`, record and worktree unchanged); Mutant 4 fails (`1 failed | 22 skipped`, archives the record and destroys the worktree).

#### Reproducer code for M-1 to M-4

Append to `packages/plugins/runtime-herdr/src/__tests__/fit2-admission.test.ts` (for `M-1`, `M-2`, `M-3`):

```ts
import { symlinkSync } from "node:fs";

describe("REVIEW probes for items 1, 2 and 3", () => {
  it("REVIEW-1a: checkSubject after mkdir refuses when symlinked parent changes before mkdir", async () => {
    const real1 = join(root, "real1");
    const real2 = join(root, "real2");
    const alias = join(root, "alias-state");
    mkdirSync(real1, { recursive: true });
    mkdirSync(real2, { recursive: true });
    symlinkSync(real1, alias);
    process.env["AO_STATE_ROOT"] = alias;
    const h = setup({ mode: "isolated" });
    rmSync(h.sessionsDir, { recursive: true, force: true });
    const err = await h
      .sm({
        onStage: async (stage) => {
          if (stage === "subject-fixed") {
            rmSync(alias, { force: true });
            symlinkSync(real2, alias);
          }
        },
      })
      .spawnOrchestrator({ projectId: "my-app" })
      .catch((e: unknown) => e);
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
    expect(err).toMatchObject({ reason: "admission-path" });
    expect((err as Error).message).toContain("the empty directories that this start made stay");
    expect(h.workspaceCalls).toEqual([]);
  });

  it("REVIEW-1b: checkSubject before reservation refuses when symlinked parent changes before reservation", async () => {
    const real1 = join(root, "real1b");
    const real2 = join(root, "real2b");
    const alias = join(root, "alias-state-b");
    mkdirSync(real1, { recursive: true });
    mkdirSync(real2, { recursive: true });
    symlinkSync(real1, alias);
    process.env["AO_STATE_ROOT"] = alias;
    const h = setup({ mode: "isolated" });
    const err = await h
      .sm({
        onStage: async (stage) => {
          if (stage === "before-reservation") {
            rmSync(alias, { force: true });
            symlinkSync(real2, alias);
          }
        },
      })
      .spawnOrchestrator({ projectId: "my-app" })
      .catch((e: unknown) => e);
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
    expect(err).toMatchObject({ reason: "admission-path" });
    expect(h.workspaceCalls).toEqual([]);
  });

  it("REVIEW-2a: reuse candidate re-read after setupWorkspaceHooks catches R4 changes", async () => {
    const h = setup({ mode: "project", strategy: "reuse" });
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    const origPush = h.hookCalls.push.bind(h.hookCalls);
    h.hookCalls.push = (...items: string[]) => {
      writeRecord(h, FIXED, { ...record, launchFailed: "failed during hooks" });
      return origPush(...items);
    };
    const err = await startError(h.sm());
    expect(rows(err)).toEqual([[FIXED, "not-reused", "its launch failed"]]);
  });

  it("REVIEW-2b: G1 row 4 selects a handleless orchestrator record with a live launch owner", async () => {
    const h = setup({ mode: "isolated" });
    const stat = readFileSync("/proc/self/stat", "utf-8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    orchestrator(h, `${FIXED}-1`, null, {
      status: "spawning",
      launchPid: String(process.pid),
      launchPidStart: `stat:${start}`,
    });
    const err = await startError(h.sm());
    expect(rows(err)).toEqual([
      [`${FIXED}-1`, "in-progress", `launch in progress by ao process ${process.pid}`],
    ]);
  });

  it("REVIEW-3a: findReusableOrchestrators acquires Lock A and refuses admission-busy when A is held", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    const paused = gate();
    const holder = startError(
      h.sm({
        onStage: async (stage) => {
          if (stage === "lock-held") {
            paused.reach();
            await paused.wait;
          }
        },
      }),
    );
    await paused.reached;
    try {
      const err = await h
        .sm({ waitMs: 50 })
        .findReusableOrchestrators?.("my-app")
        .catch((e: unknown) => e);
      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      expect(err).toMatchObject({ reason: "admission-busy" });
    } finally {
      paused.open();
      await holder;
    }
  });

  it("REVIEW-3b: findReusableOrchestrators after 3 changing rounds returns reusable records and drops the changing one", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    paneRuns("w4:p1", "term_b");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    let changing = orchestrator(h, `${FIXED}-2`, pinned("w4:p1", "term_b"));
    let n = 0;
    herdr.on["pane get"] = async (args, socket, answer) => {
      if (args[2] === "w4:p1") {
        n += 1;
        changing = writeRecord(h, `${FIXED}-2`, {
          ...changing,
          restoredAt: `2026-10-0${n}T00:00:00.000Z`,
        });
      }
      return answer();
    };
    const reusable = await h.sm().findReusableOrchestrators?.("my-app");
    expect(reusable?.map((s) => s.id)).toEqual([`${FIXED}-1`]);
  });
});
```

Append to `packages/plugins/runtime-herdr/src/__tests__/fit2-startup.test.ts` (for `M-4`):

```ts
import { launchIdentityToken } from "@aoagents/ao-core";

describe("REVIEW probe for item 6", () => {
  it("REVIEW-4: F-9 refuses when no herdr runtime plugin is loaded (step 5)", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: false });
    const worktree = writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE));
    const before = h.file("app-1");
    const token = launchIdentityToken(readMetadataRaw(h.sessionsDir, "app-1") ?? {});
    const err = await h.sm.kill("app-1", { confirmRuntimeClosed: token }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toBe(
      "runtime stop unconfirmed (unknown): no runtime plugin herdr is loaded; record and worktree kept",
    );
    expect(h.file("app-1")).toBe(before);
    expect(existsSync(worktree)).toBe(true);
  });
});
```

### Minor (`m`)

#### m-1 — Stale agent `isProcessRunning` sentences in `lifecycle-manager.ts` comment

- **Code:** `packages/core/src/lifecycle-manager.ts:218-221`:
  > `claude-code reads Herdr panes through core herdr.ts, which answers "no process" on an error. codex, gemini and opencode isProcessRunning still answer false on an error, so their negatives are "ambiguous".`
- **Evidence:** As noted in `CLAUDE.md:430` and `herdr_fit2_design_review_r11_sol61.md` (finding `sol m-3`), `core/src/herdr.ts` (`getHerdrPaneProcesses` / `isHerdrProcessRunning`) and `codex`, `gemini`, and `opencode` `isProcessRunning` now reject on an error rather than returning `false` or `"no process"`. Commit 8 updated the `runtime-herdr isAlive` sentence immediately below (`:221-226`) as specified by design 5.6, leaving the older agent sentences in place (implementer deviation 28 / open question 1).

#### m-2 — `readRecordStrict` in `spawnOrchestrator`'s reuse re-read is not wrapped in `records-unreadable`

- **Code:** `packages/core/src/session-manager.ts:4088` (and `:4008` in `reserveProjectMode`).
- **Evidence:** `selectOrchestratorRecords` (`:3067-3071`) wraps `readRecordStrict(sessionsDir, id)` in `try { ... } catch (err) { throw startBlocked(projectId, "records-unreadable", err); }`. At `:4088`, the post-`setupWorkspaceHooks` re-read calls `readRecordStrict(sessionsDir, candidate.record.id)` bare; an I/O error (`EACCES`/`EIO`) occurring between G1 and line `4088` throws the raw filesystem error rather than `OrchestratorStartBlockedError` (`reason: "records-unreadable"`).

---

## 3. What was found correct (items 1–10)

1. **Lock A and its subject (item 1; commit 5, 4.9, 5.3.1):** `admissionLock(sessionsDir, projectId)` fixes the canonical subject before Lock A is taken. `runAdmission` holds Lock A for local work only (`mkdirSync`, `checkSubject`, G1, G2, `.origin`, project-mode hooks, non-set project-mode branch with `stopWithinBound`, reservation with `P`, or restore copy-back/stop/transition write). Lock A is released in `finally` before any Herdr probe (`T-7.29`), before message-M probes, and before restore step 8 (`T-7.26b`, `T-7.26c`). Non-Linux platforms (`isDeliveryLockSupported() === false`) refuse when `createInSet` or `selected.length > 0` (`admission-unsupported`, `OQ-F6 (a)`), and run `reuse-only` without Lock A (`T-7.25`).
2. **Admission rounds, G, R, and message M (item 2; commit 5, 4.7, 5.3.2, 5.3.3):** 3 rounds (`ADMISSION_ROUNDS = 3`), probe answers keyed by `${record.id}\0${record.token}`, re-reading R1–R6 under Lock A in the deciding round (`T-7.23`) and re-reading the reuse candidate after `setupWorkspaceHooks` (`:4088-4097`). `classifyOrchestratorLiveness` bounds `isAlive` with `probeTimeoutMs` (10 s default), maps `isHerdrPinError` to `"its herdr pins are malformed"`, and for runtimes in `LAUNCH_END_UNPROVEN_RUNTIMES` maps `false` and `RUNTIME_NO_SERVER_ERROR_CODE` to `unknown` (`OQ-F1 (b)`). R5 blocks when the project selects another runtime (`OQ-F4 (a)`, `T-7.8`). Project-mode live pane with exited agent is reused (`OQ-F13 (a)`, `T-7.3d`). Message M shell-quotes every interpolated command token via `shellEscape` and includes the `create-pending` (`P`), empty-pane, `in-progress`, and `damaged` variants.
3. **`findReusableOrchestrators` and CLI `start.ts` (item 3; commits 5 and 6, 5.3.5):** `ensureTmux` checks `project.runtime ?? config.defaults?.runtime ?? "tmux"` (`T-7.13`). Candidates (`!isTerminalSession(s)`) are split by `isUnprovenLaunchRecord(s.metadata, selectedRuntime)` into `coreDecides` (`sm.findReusableOrchestrators`), `probed` (other runtimes with a stored handle), and `unchecked` (no stored handle, `OQ-F10 (a)`). Zero runtime calls occur after the last `sm.list` for a damaged handle accepted by the predicate (`T-7.9b`). `preflight.checkSelectedRuntime` runs before `sm.spawnOrchestrator` (`T-7.11`, `T-7.11b`). `OrchestratorStartBlockedError` is rethrown directly after `spinner.fail("No new orchestrator was started")`, printing without `"Failed to setup orchestrator:"` (`T-7.4`). All interim Herdr helpers (`isHerdrProbeTerminal`, `heldStateOf`, `runningHeldRefusal`, `runningHeldOrchestrators`, Herdr branches in `checkOrchestratorLiveness`, core `isOrchestratorRuntimeAlive`) are removed.
4. **Preflight and `ao spawn` (item 4; commit 6, 5.3.6):** `runtime-herdr` extracts `usableEndpoint()` (keeping step-1 Q0 error messages unchanged) and exposes `preflight()`, caching nothing (`fit-pins.test.ts`). `spawn.ts` `runSpawnPreflight` resolves the runtime instance from `getPluginRegistry(config)` and calls `preflight.checkSelectedRuntime` before `sm.spawn` (`T-7.14`, `T-7.15`).
5. **`runtime-stop.ts` (item 5; commit 5, 5.3.7):** The stop-less fallback `noServer && !destroyFailed` returns `destroyed` only when `!isLaunchEndUnproven(safeString(runtime.name)) && !isLaunchEndUnproven(handle.runtimeName)` (`T-7.16`).
6. **F-9 (item 6; commit 7, 5.4):** `kill(sessionId, { confirmRuntimeClosed })` is ignored when `decidedFrom` is present (`cleanup` never uses it, `T-9.12`). `retirableHandle` accepts only a well-formed handle in `LAUNCH_END_UNPROVEN_RUNTIMES` whose `launchIdentityToken(raw)` matches `confirmRuntimeClosed` (`T-9.5`, `T-9.6`). `assertNoLiveLauncher` refuses a live launcher (`T-9.7`). `retireEvidence` runs one bounded `classifyOrchestratorLiveness` call, refusing if `alive` (`T-9.1`) and recording up to 200 chars of evidence otherwise (`T-9.2`, `T-9.3`, `T-9.4`). Step 8 writes `retiredBy`, `retiredAt`, `retireEvidence`, and `retiredIdentityToken` via `updateMetadataIf(sessionsDir, sessionId, launchIdentity(raw), ...)` (`T-9.8a`), followed by today's `stopWhenReplaced`-guarded worktree destroy (managed worktrees only, `T-9.8b`, `T-9.9`), optional OpenCode purge (`T-9.8c`, `T-9.10`), and archive. Without the option, a Herdr kill refusal appends the F-9 hint with `launchIdentityToken(raw)` (`T-9.11`).
7. **Status display and fit-2a retirement texts (item 7; commit 7, 5.5, 4.5, 5.2.4):** `status.ts` populates `identityToken` and `createIncomplete` from `session.metadata` for well-formed handles in `LAUNCH_END_UNPROVEN_RUNTIMES` (`null` otherwise), prints `launch failed: <text> (identity token <t>)` or `launch incomplete (<stage>; identity token <t>)`, and includes both fields in `--json` (`status.test.ts`). `keepUnwritableLaunch` and `writeBackTransition` in `session-manager.ts` end with the F-9 retirement line and the token(s) that F-9 accepts for each state (`T-4.19c`, `T-4.19d`, `T-4.20c`, `T-4.20d`, `T-4.21e (1)`).
8. **Docs and comments (item 8; commit 8, 5.6):** `CLAUDE.md`, `docs/DEVELOPMENT.md`, and `doctor.ts` match the code and retain the by-hand retirement recipe only for damaged or handleless records that F-9 refuses (5.4.4, L-2).
9. **No regression and changed oracles (item 9):** `tmux` and `mock` behavior across start, spawn, restore, kill, status, cleanup, relaunch, and lifecycle is unchanged (`T-7.10`, `T-7.15`, `T-7.16`, `T-7.25`, 15 relaunch files). Every changed oracle in `orchestrator-herdr-start.test.ts`, `fit-startup-interim.test.ts`, `fit2-startup.test.ts`, `fit2-create-rollback.test.ts`, `start.test.ts`, `start-herdr-interim.test.ts`, and `spawn.test.ts` matches design 5.3.10, 8.1, and 8.2.
10. **Scope and size (item 10):** Only the 12 authorized product files and 2 docs files were modified (`+1473 -424` lines across product + docs; `+1415 -402` across the 12 product files; `packages/cli/src/commands/start.ts` is net `-50` lines at `+79 -129`). The ~60% increase over the design's ~920-line estimate comes from `packages/core/src/session-manager.ts` (`+1134 -224`, net `+910`), specifically: (a) module-level `classifyOrchestratorLiveness`, `outsideSetOrchestratorAlive`, and message-M formatting (`~250` lines), (b) `runAdmission`, `selectOrchestratorRecords`, `judgeOrchestratorRecord`, and `blockedAdmission` (`~439` lines), (c) refactoring `spawnOrchestrator` and `restore` into closures (`reserveProjectMode`, `copyBackArchive`, `stopAndTransition`) that execute under `runAdmission` (`~330` added / `~210` removed), and (d) F-9 helpers (`~125` lines), plus thorough JSDoc comments and Prettier wrapping. Every part implements a required design rule; no unrequested feature was added.

---

## 4. Gates, D1, and D2 verification (item 11 and section 3)

### 4.1 Gates on `13f982c2` (`/tmp/aof2ba/tip`)

- **`pnpm install --frozen-lockfile --offline --store-dir=/home/taisung/.local/share/pnpm/store/v3`** (`/tmp/aof2ba/evidence/tip_install.txt`): exit `0`.
- **`pnpm build`** (`/tmp/aof2ba/evidence/tip_build.txt`): exit `0` (all 14 workspace packages built).
- **`pnpm typecheck`** (`/tmp/aof2ba/evidence/tip_typecheck.txt`): exit `0`.
- **`pnpm lint`** (`/tmp/aof2ba/evidence/tip_lint.txt`): exit `0`, `0 errors, 5 warnings` at the exact 5 known locations:
  - `packages/cli/src/commands/spawn.ts:332:24` (`@typescript-eslint/no-non-null-assertion`)
  - `packages/core/src/activity-log.ts:91:31` (`@typescript-eslint/no-non-null-assertion`)
  - `packages/core/src/plugin-registry.ts:232:7` (`@typescript-eslint/no-non-null-assertion`)
  - `packages/core/src/session-manager.ts:3866:11` (`no-console`)
  - `packages/core/src/session-manager.ts:3873:9` (`no-console`)
- **Full `pnpm -r --no-bail test` with the `tmux` shim** (`/tmp/aof2ba/evidence/tip_test_clean.txt`, `/tmp/aof2ba/evidence/tip_test_clean_summary.txt`): exit `0`.

| Package | Base (`c6d80383`) | Tip (`13f982c2`) | Difference and explanation |
| --- | --- | --- | --- |
| `@aoagents/ao-core` | 1847 passed, 1 expected fail (65 files) | 1869 passed, 1 expected fail (67 files) | **+22**: +15 `orchestrator-admission.test.ts`, +4 `retire-herdr.test.ts`, +3 `runtime-stop.test.ts` (`T-7.16`), `orchestrator-herdr-start.test.ts` 4 renamed |
| `@aoagents/ao-plugin-runtime-herdr` | 272 passed (9 files) | 327 passed (11 files) | **+55**: +32 `fit2-admission.test.ts`, +3 `fit2-admission-fork.test.ts`, +12 `fit2-create-rollback.test.ts` (`T-9.1`–`T-9.12`), +4 `fit2-startup.test.ts` net (+6 `T-7.8`, +1 `T-7.8b`, +2 `T-7.10`, −5 `T-7.8a`), +4 `fit-pins.test.ts` (`preflight`), `fit-startup-interim.test.ts` 2 renamed |
| `@aoagents/ao-cli` | 447 passed (29 files) | 489 passed (30 files) | **+42**: +24 `start-herdr-guard.test.ts`, +7 `start.test.ts` net (+28 new, −21 renamed), +5 `session.test.ts` (`T-9.13`), +4 `status.test.ts` (5.5), +2 `spawn.test.ts` (`T-7.14`, `T-7.15`), `start-herdr-interim.test.ts` 12 renamed |
| `agent-claude-code` | 368 passed (10 files) | 368 passed (10 files) | 0 |
| `agent-codex` | 318 passed (7 files) | 318 passed (7 files) | 0 |
| `agent-gemini` | 99 passed (3 files) | 99 passed (3 files) | 0 |
| `agent-opencode` | 365 passed (6 files) | 365 passed (6 files) | 0 |
| `runtime-tmux` | 116 passed (6 files) | 116 passed (6 files) | 0 |
| `workspace-worktree` | 85 passed (5 files) | 85 passed (5 files) | 0 |
| `scm-github` | 140 passed, 5 skipped (3 files) | 140 passed, 5 skipped (3 files) | 0 |
| `tracker-github` | 42 passed (1 file) | 42 passed (1 file) | 0 |
| `notifier-desktop` | 26 passed (1 file) | 26 passed (1 file) | 0 |
| `integration-tests` | 91 passed, 24 skipped (10 passed, 3 skipped files) | 91 passed, 24 skipped (10 passed, 3 skipped files) | 0 |

*(Note on environment during initial run `/tmp/aof2ba/evidence/tip_test.txt`: before `tee` was linked into `/tmp/aof2ba/bin` and before `/tmp/aof2ba/bin/tmux` was restricted to checking `-S`/`-L` only in `$1`, `GH_WRAPPER` failed 4 tests with exit 141 `SIGPIPE` due to missing `tee` and `integration-tests` failed 4 `capture-pane ... -S -50` tests because `-S -50` matched the shim's loop. After linking `tee` and checking `${1:-}` in `/tmp/aof2ba/bin/tmux`, the full `pnpm -r --no-bail test` passed with `EXIT:0` in `/tmp/aof2ba/evidence/tip_test_clean.txt`.)*

- **`SAME_ID_DEFECTS=red` across `same-id` test files** (`/tmp/aof2ba/evidence/tip_red_list.txt`, `/tmp/aof2ba/evidence/base_red_list.txt`): both base (`c6d80383`) and tip (`13f982c2`) produce the exact same **21 failures** (**R2: 15, R3: 6**; `diff -u` is empty). Both lists are non-empty and include `[same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second` and `[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it > kill and restore of one ID: the active record at the end names a live runtime`.
- **The 15 relaunch test files** (`/tmp/aof2ba/evidence/tip_relaunch_15.txt`): all 15 files (**305 tests**: core 4 files / 133 tests; CLI 3 files / 56 tests; `agent-claude-code` 3 files / 49 tests; `agent-codex` 1 file / 10 tests; `agent-gemini` 1 file / 10 tests; `runtime-tmux` 3 files / 47 tests) pass (`RELAUNCH_EXIT:0`).
- **`gitleaks git --log-opts=c6d80383..13f982c2 --redact`** (`/tmp/aof2ba/evidence/gitleaks.txt`): `4 commits scanned`, `no leaks found`, `GITLEAKS_EXIT:0`.

### 4.2 Landing readiness (`git merge-tree`, item 13)

Ran `git merge-tree --write-tree --merge-base c6d80383 main 13f982c2` (`/tmp/aof2ba/evidence/merge_tree.txt`):

```text
7a0a189e0f851e335a555264a3ff353177db9e89
MERGE_TREE_EXIT:0
```

Conflicting paths: **none**. Local `main` has 3 docs commits in `development/` after `c6d80383` (`4c372bd7`, `1fb3e5ad`, `d8c116c0`), and `c6d80383..13f982c2` touches no file under `development/`.

### 4.3 D1 and D2 evaluation (item 11)

- **D1 on `/tmp/aof2ba/base`** (`/tmp/aof2ba/evidence/d1_summary.json`, `d1_new_failed.txt`, `d1_new_passed.txt`, `d1_kept_failed.txt`): Comparing the JSON test results of the 16 new/changed test files on `13f982c2` (485 tests) against `c6d80383` (366 tests) gives **163 new test names** (both lists non-empty: `d1_new_failed.txt` has 141 entries including `T-7.16: the no-server row applies only to a runtime outside the unproven set a stop-less runtime named herdr: destroy resolves, isAlive rejects with no-server: unknown => AssertionError: expected 'destroyed' to be 'unknown'`; `d1_new_passed.txt` has 22 entries including `T-7.3d: an exited agent in a live pane project mode, strategy reuse: reused (G reads no activity), no create`). In addition, **15 kept test names** fail on `c6d80383` for their new fit-2b assertions/oracles (`T-4.11`, `T-4.16`, `T-4.17` ×6, `T-4.19c`, `T-4.19d`, `T-4.20c`, `T-4.20d`, `T-4.21e (1)`, `r2 M-3` ×2).
- **Judgment of the 22 new tests that pass on `c6d80383`:** Justified. Each is an explicit preservation control (`T-7.7` ×3, `T-7.10` ×2, `T-7.12`, `T-7.15`, `T-7.16` mock control, `T-7.25` mock control, `T-9.7` live-launcher refusal, `T-9.12` cleanup refusal, `T-9.13` no-option control, `orchestrator-herdr-start.test.ts` live/other-runtime controls ×2, `start.test.ts` `done`/tmux/prefix controls ×4), the kept half of a split matrix (`T-7.3d` core project mode, where core's base `isOrchestratorRuntimeAlive` also did not check agent activity; `T-7.22` CLI ×2, where the base CLI also reused a live record across modes), or `T-7.8b` (whose 4.6 dispatch landed in fit-2a).
- **D2-a, D2-b, and T-7.9b D2 (`/tmp/aof2ba/evidence/d2_runs.txt`):**
  - **D2-a** (reverting `admissionLock` to the r8 `realpathSync` else `resolve` rule): fails `src/__tests__/delivery-lock.test.ts` (`4 failed | 11 passed`, including `× a symlinked parent gives one subject before and after the mkdir`).
  - **D2-b** (the coherent r8 reversion: r8 `admissionLock` rule plus disabling `checkSubject` in `session-manager.ts`): fails `D2-b: the schedule of T-7.21c with one more barrier (design r11 8)` in `fit2-admission-fork.test.ts` (`1 failed | 2 skipped`), because process 2 reaches `before-reservation` while process 1 waits there and both processes admit launches (`app-orchestrator-1` and `app-orchestrator-2`). On unmodified `13f982c2`, `D2-b` passes (`processTwoReachedTheBarrier: false`, one launch).
  - **T-7.9b D2** (splitting CLI candidates by `s.runtimeHandle?.runtimeName === "herdr"` instead of `isUnprovenLaunchRecord(s.metadata, selectedRuntime)`): fails `T-7.9b` in `start-herdr-guard.test.ts` (`expected 'exit 0' to be 'exit 1'`), making an extra `isAlive` call after `list:end` and reusing the damaged handle.

---

## 5. Judgment of the implementer's 29 deviations and 4 open questions (item 12)

### 5.1 Deviations (1–29)

| # | Judgment |
| --- | --- |
| 1 | **Accept.** `Runtime.isAlive` returns `boolean`, so core sees `false` for both `pane_not_found` and another terminal; the combined text `"herdr answered that the pane does not exist or that it has another terminal"` is accurate. |
| 2 | **Accept.** Core does not have access to a plugin's private `binPath`; falling back to `launch.bin ?? "herdr"` when `herdrBin` is not pinned in the handle is clean. |
| 3 | **Accept.** `"socket not recorded"` for an unpinned handle is clear and accurate. |
| 4 | **Accept.** Design 4.7 and 5.3.2 evaluate R1–R6 and R8 under Lock A before probing R7 outside Lock A. Thus an isolated record in `spawnOrchestrator` fails R8 (`not-reused`, `"an isolated record"`) before R7, while message M still probes it outside Lock A and prints the same `<answer>`. |
| 5 | **Accept.** Probing after round 3 when no round 4 will read the records would do useless work before throwing `records-changed`; `T-7.23` verifies the 2 probes across 3 rounds. |
| 6 | **Accept.** For `restore`, any other selected record blocks; `"the restore of <id> would launch next to it"` is a clear `not-reused` reason. |
| 7 | **Accept.** Including `block.reason` in `<state>` for every `not-reused` record follows the `<state>` grammar in 5.3.8. |
| 8 | **Accept.** `text("sessionId") ?? raw["tmuxName"] ?? record.id` matches how `runtime-herdr` labels workspaces at creation (`createConfig.tmuxName ?? createConfig.sessionId`). |
| 9 | **Accept.** Making `findReusableOrchestrators?` optional on `SessionManager` avoids breaking partial test mocks while real `createSessionManager` always provides it. |
| 10 | **Accept.** Exporting `classifyOrchestratorLiveness` from `session-manager.ts` via `index.ts` and keeping `outsideSetOrchestratorAlive` for non-set project-mode records preserves all existing tmux error texts. |
| 11 | **Accept.** Design 5.3.5 step 8 strips the `"Failed to setup orchestrator:"` prefix only for `OrchestratorStartBlockedError`; keeping the prefix for preflight/other errors matches the spec. |
| 12 | **Accept.** Required by R5 (`OQ-F4 (a)`): a Herdr record on a `mock`-runtime project now blocks with `"the project now selects mock"` instead of `"unproven"`. |
| 13 | **Accept.** `"create <stage>"` matches 5.3.8's `<state>` specification (`[, create <stage>]`). |
| 14 | **Accept.** Using `findReusableOrchestrators` with `waitMs: 50` in `T-7.26c` tests that Lock A was released without starting a new launch (subject to fixing `M-3` so `reuse-only` Lock A acquisition is itself tested while A is held). |
| 15 | **Accept.** Matches design 5.3.5 step 5 verbatim. |
| 16 | **Accept.** A launch with an empty pane ID cannot be attached with `ao session attach <id>`. |
| 17 | **Accept.** `runtime-herdr` cannot import `@aoagents/ao-cli`; checking `session.metadata` in `T-4.12` and the rendered status output in `packages/cli/__tests__/commands/status.test.ts` covers both layers. |
| 18 | **Accept.** Combining `liveness.reason` with `firstErrorLine(liveness.cause)` capped at 200 chars preserves both the classifier category and the underlying Herdr CLI error in `retireEvidence`. |
| 19 | **Accept.** In the `"not settled"` unwritable variant, AO cannot know whether `before` or `after` is on disk; printing `<identity token>` plus both candidate tokens and pointing to `ao status` gives the operator exact, truthful information. |
| 20 | **Accept.** After step 7a succeeded and the write-back failed, the record holds the transition write's identity (`owned`), so `launchIdentityToken(owned)` is the exact token F-9 requires. |
| 21 | **Accept.** Appending the F-9 retirement line to `refusal.hint` only for a direct kill (`!decidedFrom`) with `stopped.outcome === "unknown"` and `isLaunchEndUnproven(handle.runtimeName)` matches 5.4.2. |
| 22 | **Accept.** Session IDs are validated by `SAFE_SESSION_ID_PATTERN` and identity tokens are 16 lowercase hex digits; neither contains shell metacharacters. |
| 23 | **Accept.** The refusal messages in `retirableHandle` and `retireEvidence` include every required fact of 5.4.2 and end with `"Nothing was changed."` |
| 24 | **Accept.** Printing `"Session <id> retired."` when `--confirm-runtime-closed` is used distinguishes owner retirement from a confirmed runtime kill. |
| 25 | **Accept.** Putting `T-9.8c` and `T-9.10` in `packages/core/src/__tests__/session-manager/retire-herdr.test.ts` where `opencode-api.js` is mocked avoids conflicting mocks in `fit2-create-rollback.test.ts`. |
| 26 | **Accept.** The 4 unit tests of `preflight()` in `fit-pins.test.ts` directly guard 5.3.6. |
| 27 | **Accept.** Keeping the existing filenames `start-herdr-interim.test.ts` and `fit-startup-interim.test.ts` preserves git history across the oracle migration. |
| 28 | **Accept for fit-2b** (design 5.6 only asked for the Herdr sentence in `lifecycle-manager.ts`); tracked as minor `m-1` and answered in Open Question 1 below. |
| 29 | **Accept.** Constructing `"ab".repeat(8)` in test code avoids false-positive `gitleaks` matches on 16-hex literals after `TOKEN =`. |

### 5.2 Open questions (1–4) and recommendations

1. **Open question 1 (`lifecycle-manager.ts` comment on agent `isProcessRunning`):**
   - **Recommendation:** **Yes, update the agent sentences** in `packages/core/src/lifecycle-manager.ts:218-221` (either in the follow-up commit that adds the tests for `M-1`–`M-4`, or in the next cleanup round) so they match `CLAUDE.md:430` (both `core/src/herdr.ts` and `codex`/`gemini`/`opencode` `isProcessRunning` now reject on errors rather than answering `"no process"` or `false`).
2. **Open question 2 (Deviation 4: R8 evaluated before R7 for isolated records in `spawnOrchestrator`):**
   - **Recommendation:** **Keep R8 before R7 as implemented.** Design 4.7 and 5.3.2 explicitly evaluate R1–R6 and R8 from record fields under Lock A so that `spawnOrchestrator` never probes an isolated record during the admission rounds (only a reusable R8 candidate is probed in `start` mode; blocking records are probed once *after* Lock A is released to populate `answer` in message M). Moving R8 after R7 would cause `spawnOrchestrator` to run unnecessary admission rounds for isolated records that it can never reuse anyway.
3. **Open question 3 (Deviation 22: unquoted `<id>` and `<identity-token>` in warning/hint F-9 lines vs shell-quoted in message M):**
   - **Recommendation:** **Keep as implemented.** Session IDs (`^[a-zA-Z0-9_-]+$`) and 16-character hex identity tokens (`^[0-9a-f]{16}$`) never require shell quoting, and keeping `ao session kill <id> --confirm-runtime-closed <token>` unquoted in the one-line warnings and `Next:` hints matches the existing `retry: ao session kill ${sessionId}` convention in `session-manager.ts`.
4. **Open question 4 (Doc 0004 update after the round):**
   - **Recommendation:** **Agree** — `development/` docs are updated by the orchestrator after landing per the brief's rules.

---

## 6. Cleanup evidence

1. **Own processes:** Scanned `/proc/<pid>/environ` for `/tmp/aof2ba` (`/tmp/aof2ba/evidence/own_procs.txt`):
   ```text
   OWN_PROCESSES:[]
   ```
2. **Private tmux server:** Killed and verified `/tmp/aof2ba/evidence/tmux_after.txt`, then removed the socket file `/tmp/tmux-44402/aof2ba-tests`:
   ```text
   no server running on /tmp/tmux-44402/aof2ba-tests
   ```
   No command was run against the default tmux server.
3. **Real state root scan (`find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2ba-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'`, `/tmp/aof2ba/evidence/ao_state_scan.txt`):**
   ```text
   /home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
   /home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-orchestrator
   /home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
   /home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
   /home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/.agent-conversations
   /home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2250
   /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
   /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
   /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
   ```
   Attribution of each path:
   - `f6790d5546be-agent-skills/sessions` and `.../sessions/as-orchestrator`: concurrent `agent-skills` lifecycle worker (PID `3540453`).
   - `6513108c38cb-Nexus/sessions`, `.../sessions/nex-orchestrator`, `.../sessions/.agent-conversations`, and `.../sessions/nex-2250`: concurrent `Nexus` lifecycle worker (PID `140323`) and its active `nex-2250` session/hook activity.
   - `60756641ca25-agent-orchestrator/sessions`, `.../sessions/ao-orchestrator`, and `.../sessions/ao-73`: concurrent `agent-orchestrator` lifecycle worker (PID `3539803`) polling `ao-orchestrator` and `ao-73`.
   None of these writes was made by this review: no `ao` command was executed, and every `pnpm`/`node`/test command ran under `env -i HOME=/tmp/aof2ba/home`.
4. **`~/.ao/bin` unchanged (`/tmp/aof2ba/evidence/ao_bin_end.txt`):**
   ```text
   total 28
   drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
   drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
   -rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
   -rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
   -rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
   -rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
   ```
   `diff -u /tmp/aof2ba/evidence/ao_bin_start.txt /tmp/aof2ba/evidence/ao_bin_end.txt` is empty (`AO_BIN_UNCHANGED`).
5. **Scratch directory removal:** `/tmp/aof2ba` and `/tmp/aof2ba-marker` removed after copying all cited receipts into this review file.
