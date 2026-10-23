LAND-WITH-CHANGES

# Herdr fit-2a code review r1 (Codex)

Target `36caf8a9..a999a78f`; HEAD verified `a999a78f`. No code edits, commits, push, PR or network actions are authorized by this brief.

Verdict: 0 blocking, 3 major coverage findings, 0 minor. Current code passed the added ownership probes; the required changes are tests that independently guard the three identity predicates. Build/typecheck/lint/full tests pass, the 21 expected red failures match the base, gitleaks is clean, and merge-tree has no conflicts.


## Isolation and initial evidence

Started with `touch /tmp/aof2as-marker`. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Scratch archive: `/tmp/aof2as/tip`, from `git archive a999a78f`. Node/pnpm/tests run with `env -i`, scratch HOME/TMPDIR, CI=1, HUSKY=0, NPM_CONFIG_OFFLINE=true and a link-only PATH. gh accepts only --version/auth status; tmux shim uses `-L aof2as-tests` and unsets TMUX. No agent binary or herdr is on PATH. Install uses cached pnpm 9.15.4/store v3.

Read design §8.1 first, the required referenced sections, r11 design check and implementation brief before code. The design check's m-1/m-2 are requirements. The startup admission gap, same-ID R3/M-6 window, hidden-server/RH limits, R-Q and done-state duplicate delivery remain stated limits.

## Evidence log

- Offline frozen install passed (1.4 s). Expected pre-build warning: packages/ao's CLI dist entry does not exist yet; Husky skipped.
- Six commits, in order: `2399674a`, `6c2bd47e`, `b3fcae77`, `9324e7ac`, `d545063e`, `a999a78f`.
- Diff: 27 paths, +5695/-295; nine product paths, two docs, remaining tests.
- Build/typecheck passed. Lint: zero errors, exactly five known warnings at spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:3228/3235.
- Gitleaks: six commits scanned, no leaks. Merge-tree exit 0, tree `82cfdb8c3800a5ebd2e132fe0460891fae44a8b0`, no conflicting paths.
- Initial full run: core 1847 + one expected failure; runtime-herdr 261; CLI 447. Agent-claude-code had nine failures in unchanged relaunch-conversation tests because the scratch PATH omitted jq/flock. Added those basic utilities; rerun is required to distinguish this reviewer-environment failure from product behavior.

## New findings (coverage; current code passed all three added probes)

### M-1 — Ordinary settlement's launch-identity compare has no replacement test

`packages/core/src/session-manager.ts:738`; tests `packages/plugins/runtime-herdr/src/__tests__/fit2-create-rollback.test.ts:1251` and `:1804`.

The tests cover a different claim pair and uncertain null, but not a different identity with the resident process's same pair. In scratch, changing only `{ identity }` in the ordinary settlement attempt to `{ identity: {} }` built successfully and passed all 65 original create/rollback tests. It wrongly cleared a replacement's claim in this added schedule: resident restore succeeds through step 10; `postLaunchSetup` replaces the record by copying it and changing only `restoredAt` to `2099-01-01T00:00:00.000Z`, retaining the PID/start pair; step 12 must leave that replacement byte-equal. Correct tip passes; mutant fails byte equality (generation advances and the claim disappears). Add this schedule and an explicit no-claim-clear assertion. A process pair is shared by resident operations, so the identity compare is necessary independently of the later-pair control. Severity follows the brief's "risky rule that no test guards" criterion, not a defect in the present comparator.

### M-2 — Publication tests protect fixed after but not the before write predicate

`packages/core/src/session-manager.ts:799`; tests `packages/plugins/runtime-herdr/src/__tests__/fit2-create-rollback.test.ts:1650`.

In scratch, inserting `delete before["restoredAt"];` immediately after `const before = launchIdentity(owned)` built and passed all 65 original tests, including T-4.20g. That test replaces P with H and therefore guards after-adoption, not a write into another pending launch. Added schedule: successful worker create; before its handle publication (the final mocked pane-get reply), copy its pending record, change only `restoredAt`, retain P and the resident claim pair. Correct tip rejects publication and preserves the replacement byte-for-byte. The mutant succeeds and publishes H into it. Add a before-identity replacement test, preferably parameterized over every launch identity key; retain the existing after-adoption controls. This is a missing regression guard, not an observed overwrite by unmodified tip.

### M-3 — Restore write-back tests do not independently guard launch identity

`packages/core/src/session-manager.ts:5503`; tests `packages/plugins/runtime-herdr/src/__tests__/fit2-create-rollback.test.ts:1405`.

Replacing `{ ...launchIdentity(owned), ...transition.publishedClaim }` with `{ ...transition.publishedClaim }` in scratch built and passed all 65 original tests. T-4.19 checks claim-only changes, so it cannot distinguish this mutant. Added schedule: handleless terminal Herdr record with missing worktree; restore writes 7a; the workspace-restore stand-in replaces the pending record with the same resident pair and a different `restoredAt`, then throws. Correct tip warns and leaves that replacement byte-equal. The mutant writes the old restoredAt back, removes P and clears the replacement's claim. Add this schedule for step 8, with a plain-create-error sibling for step 9. This is coverage of a required ownership rule; current code passes the probe.

Measured results: correct implementation, 3/3 added probes pass. Each mutant: core build exit 0, original create/rollback suite 65/65 pass, its added probe exit 1 for the stated ownership violation. Probes and mutations exist only in the scratch archive.

## Gates (independent scratch runs)

- `pnpm install --frozen-lockfile --offline --store-dir <cached store v3>`: pass.
- `pnpm build`: pass; `pnpm typecheck`: pass.
- `pnpm lint`: pass, five known warnings (locations above), plus ESLint's existing .eslintignore migration notice.
- Final isolated `pnpm -r --no-bail test`: exit 0, all 13 test packages pass. Core 1847 passed/1 expected fail; runtime-herdr 261; CLI 447; Claude Code 368; Codex 318; Gemini 99; OpenCode 365; runtime-tmux 116; workspace-worktree 85; scm-github 140/5 skipped; tracker-github 42; notifier-desktop 26; integration-tests 91/24 skipped. Private-tmux cases ran (zero skipped in runtime-tmux and agent packages). No live agent/herdr binary was on PATH.
- Baseline archive full run: core 1787/1 expected fail; runtime-herdr 146; CLI 444; other package totals as tip. The concurrent base/tip full runs collided through their shared private tmux test server: base integration 3 failures, tip integration 4 failures, all missing session/output. No product changes in these paths. Running the tip full gate alone passed, and baseline integration alone then passed 91/24 skipped. These supersede the reviewer-environment failures; no product failure is concealed by an unexplained retry.
- Counts match the implementer's report: core +60 (37 error guards, 6 lock subject, 5 Herdr, 5 types, 4 token, 3 send refusal), runtime-herdr +115 (65 create/rollback, 18 dispatch/restore, index net +31, fit-reads +1), CLI +3. Other counts unchanged.
- `SAME_ID_DEFECTS=red pnpm exec vitest run same-id` across all nine packages containing same-id tests: tip and baseline each have exactly 21 failures; same full-name set. R2 15/R3 6. No fit-2a regression. Expected nonzero exits retained.
- `gitleaks git --log-opts=36caf8a9..a999a78f --redact`: exit 0, six commits scanned, no leaks.
- `git merge-tree --write-tree --merge-base 36caf8a9 main a999a78f`: exit 0, tree `82cfdb8c3800a5ebd2e132fe0460891fae44a8b0`. Conflicting paths: none. This writes no ref; no branch changed.

## Correct behavior and scope checked

- F-3 removes blocked from SETTLED_STATES, refuses at all three specified sites, retains blocked-as-consumed after idle, and forwards the typed refusal through core before restore and through CLI's non-tmux delegation as the specified stderr/exit-1 result. Tmux's direct delivery path is unchanged.
- F-4 plugin follows all six create steps: compatible must be exactly true; Q1 binds the exact socket/message and Q2 its measured prefix after strict F1 parsing; near misses and ambiguous writes produce typed partials. There is no close command in create. Script removal is confined to pre-submission failures; post-run get validates pane and terminal and keeps a changed terminal in terminalAfterRun.
- Worker/project/isolated launch reservations carry P and claims before runtime create. Pre-create fields persist for unprepared agents. Typed partials reach the resource-preserving rollback and publish their handles. Plain failures and non-set runtimes retain their rollback route. Prompt/worktree/prepared session retention is exercised with both agent shapes.
- `publishOwnLaunch` computes before/after once using merge semantics that skip undefined; every undecided attempt (throw/null, including retry) has a strict read. Adoption uses only fixed after. Not-own removes/settles nothing; unwritable carries the fixed identities through the post-create catch. The two final conditional clears and three warning variants implement r11 m-1. I found no current-code interleaving that publishes into a replacement or clears another identity's claim; the added probes passed.
- Ordinary settlement compares identity plus the own pair, reads strictly after an uncertain null, retries once, and preserves later pairs. The added resident m-2 test tests its exact read/retry sequence; its later-pair control preserves bytes. Relaunch calls the shared clear under the same lock with `extra`, with its former retries and end-state behavior retained.
- Restore's 7a CAS compares identity and the claim as read; write-back compares publishedClaim and clears only a non-null own claim. Step 9 partial and step 10 success use publication recovery; step 12 settles the result identity even after nonfatal setup failure. Damaged parse failures are refused at step 7 when the predicate names Herdr; archive refusal releases only its own copy-back. P and partial records cannot be restored past the unknown stop. Admission A/G is correctly absent in fit-2a.
- All dispatch sites are covered: startup's two probes and stop; restore step 7; kill; enrichment/list; cleanup's dead-runtime rule. Missing Herdr plugin is unknown/refused or receives no probe, never delegated to tmux. An unloaded non-set runtime keeps kill's earlier skip; list uses its fallback. Lifecycle and send already dispatch by the stored runtime and are unchanged apart from the specified send refusal. The process-liveness/R4 read contract and fit-1 interim startup files are unchanged.
- Commit-1 exports are additive; guards accept cross-copy structural errors and reject tested near misses. Rule Q, endpoint normalization, token hashing, admission subject/symlink invariance and predicate cases have direct unit coverage. Names first used by fit-2b are expressly authorized by §8.1.
- The documented seven interim notes and CLAUDE create sentence match the code. Startup's reuse of a live kept partial and direct isolated core start's lack of old-record admission are disclosed interim limits, not completed fit-2 admission. The recovery is the by-hand recipe, not unimplemented F-9.

## Size and necessity

Product additions/deletions by path: session-manager +951/-184; runtime-herdr +267/-53; runtime-errors +238; delivery-lock +66/-2; herdr +62/-2; types +57/-1; index +27; metadata +14/-1; CLI send +29/-3. Total +1711/-246, nine product paths as authorized. No agent plugin, lifecycle product, startup CLI, status, preflight caller or retirement command was added.

The estimate of ~1030 product lines undercounted the explicit protocol and diagnostics. The new error module alone is 238 lines; its APIs plus types/guards/Q/subject/token/exports are ~480 additions against the commit-1 estimate of 175. Session-manager adds ~245 lines of module-level publication/settlement/warnings plus ~200 lines of ownership/rollback/reservation helpers and ~270 lines in restore, in addition to spawn/start adaptations. These implement requested branches; the long protocol comments and warning composition account for much of the expansion. The separate rollback outcome/publication error adapters reduce duplicated ownership decisions. No behavior outside §8.1 was found. Some comments could be shorter, but removing safety branches to meet the estimate would be wrong.

Tests add +3972/-48: the two integration-style files alone are 1848 and 479 lines. Their real worktree/stand-in/fault-injection harness and the many before/after-effect and claimless schedules explain the bulk. This is justified risk coverage, with the three independent comparator omissions above. A sixth test-only commit closes a discovered dispatch-site gap; its placement has no product effect.

## Judgment of the implementer's 16 deviations

| # | Judgment |
| --- | --- |
| 1 | Accept projectId argument to admissionLock: needed for the specified structured refusal; additive API. |
| 2 | Accept omitting unimplemented F-9 from the warning in fit-2a; required by §8.1. |
| 3 | Accept conditional claim wording in write-back warning; claimless restore must not assert an own claim. |
| 4 | Accept appending the not-own partial-restore warning to the thrown error; it preserves resources and exposes the retained pane/socket in the caller's error. |
| 5 | Accept reading under lock only for relaunch's extra callback; updateMetadataIf performs the ordinary atomic compare, with a separate strict read after null. |
| 6 | Accept mergedRecord skipping undefined: matches metadata's merge, necessary for fixed after. |
| 7 | Accept dynamic import of built worktree plugin in tests, given the authorized file list and build-first gate. It creates a test-build dependency; full root build covers it. |
| 8 | Accept the step-10 not-own thrown error as the operator warning; its text names the kept runtime and no separate warning is needed. |
| 9 | Accept comparing the later pair, not the full success record, in T-4.18: promptDelivered legitimately writes later. Add the independent launch-identity case in M-1. |
| 10 | Accept raw record fixture writes: writeMetadata filters these keys, so direct whole-record replacement is the right fault schedule. Keep such writes confined to scratch tests. |
| 11 | Accept fake timers for the empty-ID readiness wait. |
| 12 | Accept the local fixture-parser helper copy; avoids cross-package private test import. |
| 13 | Accept deferred F-9/status/admission assertions: precisely §8.1's required split. |
| 14 | Accept sixth test-only commit after docs: closes the missing startup-stop dispatch guard without changing behavior. No history rewrite is needed for landing. |
| 15 | Accept synthetic empty Herdr handle solely as the refusal error payload; no runtime call is issued with it. |
| 16 | Accept bold recipe label: it makes the retirement references findable and changes none of the established recovery steps. |

## Judgment of the four open questions

1. Keep the test-only sixth commit; its position does not weaken implementation or reviewability. Reordering is unnecessary.
2. Keep the six consumer tests as compatibility pins. Their paths intentionally retain base behavior. Creating a kept launch through real failed create could add useful composition coverage, but forcing these pins to fail on the base merely duplicates F-4 creation checks. Add F-9/status assertions with fit-2b, where those behaviors first exist.
3. Accept D2 as the relevant evidence for the seven claim/transition tests whose mechanism is absent on the base. A base pass does not make these tests vacuous; the existing mechanism-specific mutants distinguish their intended rule. M-1/M-3 ask for separate identity comparisons that those tests currently omit.
4. Existing T-2.1's text/call-count oracle remains valid for partial errors; the new step-3 matrix explicitly asserts partial type. Keeping both is sufficient; no type-only follow-up in fit-2b is required.

## D1 and changed oracles

Independently compared JSON test names for the tip's 14 changed test files with their original baseline versions: tip 573 test names, baseline 395, 181 new names (including three renames). On baseline, 115 new tests fail their assertions/calls and 46 are blocked by the three new-module import failures; 19 pass. T-3.1 was excluded from the immediate-sleep default-timeout run because the implementer's report establishes an OOM loop on the base; a bounded diagnostic is recorded separately. The report's 162 failing-new-test total counts that last case. This review does not represent an excluded/OOM case as a clean ordinary assertion failure.

The 19 base passes are exactly the reported set: six controls (T-3.5, CLI ordinary-error control, Q2 newer/older, unloaded non-set runtime, damaged non-Herdr handle); six unchanged consumer pins (kill/get-list/cleanup and three sends); seven guards of new mechanisms absent on base (resident restore T-4.16, three unprepared T-4.17 launches, later-pair T-4.18, claimless T-4.19a/b). Their classification is justified; universal base failure is too strong for preservation controls. The 161 direct/import failures plus the bounded negative do establish that new behavior is exercised. The current ownership gaps are the separate M findings above.

Changed oracles match §5.1/§5.2.7: blocked-as-settled becomes typed refusal/no raw input; failed-create close becomes partial/no close/script retention; no-usable-pane and exit-zero envelopes become partial; successful-create queues gain the post-run pane get and compatible:true; pins tests include the fourth pinned call; endpoint equality includes compatible/version/protocol; the session-form no-server workspace error becomes a partial while exact pinned Q1 retains a plain error; pane-run failure keeps the F1 cause without a close. The T-2.1 text/count oracle stays valid and type is covered in the new matrix. The three child-compile setup lists gain runtime-errors.ts because delivery-lock imports it. No fit-1 interim startup or note-2 F1 reader oracle changed.

Expanded mutant check: each of M-1/M-2/M-3 also passed **all 573 tests in all 14 changed files** (core 298, runtime-herdr 242, CLI 33), with core builds exit 0. These are independently executed mutants, not a repetition of the implementer's D2 claims. The added probe for each still fails exactly as described; correct code passes all three. Existing tests therefore do not independently enforce those three identity predicates even though their companion pair/adoption checks are exercised.

Bounded T-3.1 baseline diagnostic: copied the tip's index tests into the base archive, changed only this test's create options to `{ deliveryTimeoutMs: 0, settleTimeoutMs: 0, sendAttempts: 1 }`, then selected `-t 'T-3.1:'`. It exits 1 within 1.28 s with `TypeError: isRuntimeSendRefusedError is not a function`. This confirms the new-export failure without reproducing the report's unbounded OOM run. A future cleanup should bound the original negative schedule, but this review does not add a separate severity finding for an already disclosed test-harness limitation.

## Reproducing the three coverage findings

Start with an archive of a999a78f, install/build offline under the isolation stated above. For each row below, modify only that source expression in the scratch tree, rebuild core, then run the 14 changed test files listed by `git diff --name-only 36caf8a9 a999a78f -- 'packages/**/**test.ts'` (exclude no existing tests). The three package runs pass 298 + 242 + 33 = 573. Restore core between mutants.

| Finding | Scratch-only mutation |
| --- | --- |
| M-1 | Ordinary settlement's `clearOwnLaunchClaimOnce(..., { identity })` becomes `clearOwnLaunchClaimOnce(..., { identity: {} })`. |
| M-2 | After `const before = launchIdentity(owned)` in publishOwnLaunch, insert `delete before["restoredAt"];`. Leave after fixed. |
| M-3 | In writeBackTransition only, expected `{ ...launchIdentity(owned), ...transition.publishedClaim }` becomes `{ ...transition.publishedClaim }`. |

For the distinguishing tests, append the following to a scratch copy of `fit2-create-rollback.test.ts` so its existing helpers and mocked Herdr/worktree harness remain available. Run only `-t REVIEW`. Correct core passes all three; select the corresponding single REVIEW test under each mutant to see its ownership violation:

```ts

describe("REVIEW ownership replacements", () => {
  it("REVIEW settlement preserves a replacement with the resident pair", async () => {
    let replacement = "";
    const late: { h?: Harness } = {};
    const { h } = await residentRestore({
      postLaunchSetup: async () => {
        const own = late.h!.record(ORCH)!;
        replacement = writeRecord(late.h!, ORCH, { ...own, restoredAt: "2099-01-01T00:00:00.000Z" });
      },
    });
    late.h = h;
    await h.sm.restore(ORCH);
    expect(h.file(ORCH)).toBe(replacement);
    expect(h.record(ORCH)?.launchPid).toBe(String(process.pid));
  });

  it("REVIEW publication preserves changed before identity", async () => {
    const h = await setup();
    let replacement = "";
    afterCreate(() => {
      const pending = h.record("app-1")!;
      replacement = writeRecord(h, "app-1", { ...pending, restoredAt: "2099-01-01T00:00:00.000Z" });
    });
    const result = await spawnError(h);
    expect(result).toBeInstanceOf(Error);
    expect(h.file("app-1")).toBe(replacement);
    expect(h.destroys).toEqual([]);
  });

  it("REVIEW write-back preserves a replacement with the resident pair", async () => {
    let replacement = "";
    const late: { h?: Harness } = {};
    const h = await setup({
      workspace: {
        restore: async () => {
          const pending = late.h!.record("app-1")!;
          replacement = writeRecord(late.h!, "app-1", { ...pending, restoredAt: "2099-01-01T00:00:00.000Z" });
          throw new Error("workspace restore refused");
        },
      },
    });
    late.h = h;
    handlelessRecord(h, "app-1", { worktree: false });
    const result = await h.sm.restore("app-1").catch((error: unknown) => error);
    expect((result as Error).name).toBe("WorkspaceMissingError");
    expect(h.file("app-1")).toBe(replacement);
    expect(h.record("app-1")?.launchPid).toBe(String(process.pid));
  });
});

```

## Cleanup evidence

All long-running exec cells completed. A /proc environment scan after the last test found **[]** processes with `HOME=/tmp/aof2as/home` (excluding the scanner itself). No process was signalled by this reviewer. The private server check, under the scratch environment and explicit `-L aof2as-tests`, answered `no server running on /tmp/tmux-44402/aof2as-tests`. No default-server command ran; no other session/pane/worktree was read.

The required real-state scan printed exactly:

```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

The first two paths belong to concurrent agent-skills lifecycle/session activity (the brief identifies its worker as 3133656); the next three to Nexus lifecycle/session activity (worker 140323 in the brief); the final two to agent-orchestrator lifecycle/session activity (worker 3133311). None was written by a review command: no real-config AO command ran and every node/pnpm/test parent had scratch HOME and no inherited AO variables. The exact syscall writer of those concurrent updates was not instrumented; the path/project attribution above does not claim a measured PID attribution. Protected workers and sessions were not acted on.

Final `ls -la --time-style=full-iso ~/.ao/bin` is byte-equal to the initial listing: same entries, sizes, modes and mtimes (listing comparison, not a content-hash claim). `git diff --exit-code` passed; status shows only this review and the required .agent_report.md plus the externally supplied .agent_task.md. No tracked source was edited, no branch changed, no commit/push/PR/network action occurred. The unused private socket, `/tmp/aof2as` and `/tmp/aof2as-marker` are removed at completion; the final report records the removal check.
