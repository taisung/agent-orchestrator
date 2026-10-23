# Herdr fit-2 design r9 review — 2026-10-22 (Muse Spark 1.3)

SOUND-WITH-CHANGES

All r8 findings of both reviews are answered at design level: sol M-1/M-2/M-3 and m-1..m-5,
Muse m-1..m-6 (with the brief's merges). No new blocking or major findings. Four new minor
findings below (m-1..m-4): one test oracle that omits its probe answer (T-7.3), one CLI/G1
classification edge, one restore-scope clarification, one settlement-threading clarification.
Counts: **0 blocking, 0 major, 4 minor**. Finding IDs are local to this review.

Baseline: worktree HEAD `5f38ffd4` (verified `git log --oneline -1`; matches the brief's
required commit). Fit-1 base read as code on its branch (`git log 389b8dfe..9d51982b`,
`git show <commit>`; never checked out). This is an independent source/design audit, not an
implementation and not a live Herdr measurement. Per the brief §7, the author's report and
brief were read only after my own reading and evidence gathering.

## Initial isolation evidence

`touch /tmp/aofr9m-marker` done at start. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Review process

Read in this order: the r9 design (full, §§0–12); both r8 reviews in full; the fit-1
branch log and the fit-1 code reviews r1 (sol NOT-LAND-SAFE, muse LAND-SAFE); the R4 table
(`docs/DEVELOPMENT.md` "Absence forms of the R4 reads", rows 8/9 re-read first-hand);
`development/TODO_TRACKING.md` D-8 and the OQ-F/OQ arcs; the relaunch diff
(`git diff 3e366a01 7a20242f -- packages/core/src/session-manager.ts`) and the relaunch
section of `docs/DEVELOPMENT.md` on `7a20242f`; every product file the design changes (on
`main` and, via `git show`, at `9d51982b`); `git show 258d85bf -- development/0004_...`
and the new `r9_` fixtures. Only then the author's r9 report and r9 brief. No `ao`, `gh`
network, tmux, herdr, agent, model-turn, build or test command was run; all checks below are
`git`/`cat`/`grep`/`sed`/`ls` reads (no node/pnpm executed, so no scratch env was needed).

## r8 items: state in r9

IDs are those of each r8 review; the brief's merges apply (Muse m-1 = sol m-2,
Muse m-3 = sol m-5, Muse m-6 + sol m-1, Muse m-4 + sol's admission/R3/relaunch section).

| Finding | State in r9 | Evidence |
| --- | --- | --- |
| **sol M-1** lock-A name changes across first `mkdir` | **Closed**, residual R-A named (OQ-F9) | 4.9: subject = real path of nearest existing ancestor + missing suffix; walk goes up only on double-`ENOENT`; every other lookup state refuses (`admission-path`); subject fixed per operation; recheck under A after `mkdir`, before reservation/copy-back/transition write. Fixture `r9_admission_subject_check.txt` (read in full): r8 rule two names, r9 rule one name; `ENOTDIR` and dangling-symlink refusals. T-7.21c two-process test with pause at `sessions-dir-ready` + D2 non-vacuity |
| **sol M-2** CLI reuse bypasses live-launch rule + revalidation | **Closed** | Core `findReusableOrchestrators` (4.5/4.7/5.3.2): same rounds + same predicate R (R1 live-launcher check closes the paused-after-handle-write window via the claim kept until success settlement, 4.5); probe answers keyed by identity token; R1–R6 re-read under A in the deciding round. CLI 5.3.5 routes every set-runtime candidate to core. T-7.27 (paused in `postLaunchSetup`), T-7.28 (replace/`launchFailed`/P-reservation during probe), control T-7.7 |
| **sol M-3** restore claim has no success settlement (prepared agent) | **Closed** | 4.5 owner-aware `settleOwnClaim` (identity + own claim values; never clears a later operation's claim); per-operation table: restore settles after step 11 incl. caught `postLaunchSetup` exception, write-back clears on step-8/plain-step-9 failures, settlement after partial write, not-own on step-10 conflict; warn-and-keep when settlement unrecordable; `keepUnconfirmedLaunch` settles for every runtime. T-4.16/16b (resident process, OpenCode shape, settlement-failure variant), T-4.17/18 |
| **sol m-1 + Muse m-6** restore holds A across workspace creation; probe timeouts | **Closed** | 5.2.4: A covers G/copy-back/stop/transition write only; released at 7b before workspace restore; write-back rollback on step-8 failure. 5.3.1/4.7: 10 s core bound on every probe and every stop under A; no Herdr call under A (reuse probes between rounds). T-7.26b/c (paused/failed workspace restore, A free within 50 ms), T-7.29 (probe never answers; A obtainable meanwhile) |
| **sol m-2 + Muse m-1** status token plumbing + file count | **Closed** | 4.8 `launchIdentityToken()` in core `metadata.ts`, exported from `index.ts`; 5.5 `status.ts` `identityToken`/`createIncomplete` (null unless set-runtime), human line + additive `--json` keys; commit 7; **17 product files** |
| **sol m-3** cleanup probe + kill fallback | **Closed** | 4.6 per-site table incl. cleanup's old-handle probe (T-7.8e, zero tmux calls with a Herdr handle); kill keeps today's skip for missing plugin outside the set, refuses for missing plugin in the set. Dispatch verified against fit-1 tip sites (start `:2527`/`:2588`, restore step 7 `:4491-4514`, kill `:3094-3125`, list `:1532-1536`, cleanup `:3436-3440`) |
| **sol m-4** T-9.8 injection after retire write | **Closed** | Split T-9.8a (replace during step 7 → retire write fails, nothing removed), T-9.8b (replace in workspace-removal preamble → `stillOwned` stops removal), T-9.8c (replace in purge-holder lookup → `stillUnheld` stops), plus failed-retire-write case |
| **sol m-5 + Muse m-3** `recordMayOwnRuntime` empty-ID misstatement | **Closed** | 3.3 states the code correctly (verified: `recordNamesRuntime` `:1671-1680` matches two `id: ""` Herdr handles; `recordMayOwnRuntime` `:1692-1699` true for handleless); keeps the conservative result for `createIncomplete` (4.4); T-4.7b replaced-by-P case |
| **Muse m-2** Q1 socket at step 2 | **Closed** | 4.3: Q1 socket is `endpoint.socket` of step 1; steps 2 and 5 run with `HERDR_SOCKET_PATH=endpoint.socket`; handle stores it as `herdrSocket`. Fixture `r5_path_env_socket_and_env_session.cmd` confirms the pinned text form |
| **Muse m-4** + sol admission/R3/relaunch section | **Closed** | §6 names every shared key (`launchPid`/`launchPidStart` one settlement helper with optional identity compare; `restoredAt` write-back discipline; `runtimeHandle`/`reservationId` no conflict; `launchedRecordFor()` keeps relaunch's `launchToken`/`launchTokenAt`; retire keys new), shared functions/paths, second-landing rule (both test sets green), and states fit-2 completes neither same-ID R3 nor relaunch M-6 (restore claim after step 7; kill/F-9 take no claim). Verified relaunch side: `LAUNCH_TOKEN_KEY`/`LAUNCH_PANE_KEY`, claim CAS + `settleOnce`, Herdr refusal in the relaunch path |
| **Muse m-5** file-vs-section citations | **Closed** | 3.1/4.3 cite `r8_cli_forms_log.txt` sections (e.g. §`r8_ws_create_ping_protocol_19`), and the r9 rows cite `r9_*` sections; spot-checked rows use the section form |
| **Muse D-F1** fit-1 unverifiable | **Closed** | §2 states fit-1 from `9d51982b` with 12 differences from r8's assumptions; G0 re-verification gate retained. All 12 spot-checked (see "Fit-1 base" below) |
| sol fixture note (newer-protocol `pane run` inferred) | **Closed (measured)** | 3.1: `r9_cli_forms_log.txt` §`r9_pane_run_ping_protocol_23` — exit 1, `cli:request` `protocol_mismatch` "older than server protocol 23", 1 ping-only connection; control `r9_pane_run_ping_protocol_19_control`; `r9_strace_connects.txt` 2 `connect()` calls, both `AF_UNIX` (read in full) |
| sol OQ-F5 wording | **Applied** | OQ-F5 (a): send's liveness check and send are separate; errors read as unknown; RH B-2 open |

## New findings (all minor)

### m-1 — T-7.3 states `blocked` without the probe answer it depends on

**Design:** §5.3.10, row T-7.3. **Code where it applies:**
`packages/core/src/session-manager.ts` (G/R7, new) against the fit-1-tip record model
(`packages/core/src/metadata.ts:331-337` identity keys).

Row T-7.3: "`status=working`, enriched to `activity=exited` by the real `list()` before the
start; both modes → blocked". G never reads `activity` (4.7 R1–R7; status read is the
persisted `status`, R6). A `working` Herdr record with a parseable set-runtime handle, no
`launchFailed`/`createIncomplete`, same runtime, and an `alive` probe for its identity token
is reusable by R — that is exactly the T-7.7 control. So T-7.3's `blocked` oracle holds only
if the stand-in's pin answers something other than `alive` (e.g. `pane_not_found`, as in
T-7.2) or another R-row fails; the row states neither. As written, an implementer that pins
a live pane (the natural reading of "activity=exited but the pane runs", the fit-1 sol M-1
case) gets `reused`, and the test fails for the wrong reason — or worse, an implementer
"fixes" it by making G read `activity`, contradicting 4.7 and OQ-F1 (b).

**Evidence:** T-7.1 states its pin answer (F1 no-server) and T-7.2 states its pin answers
(`pane_not_found`/another terminal); T-7.3 is the only G row without one. The fit-1 sol M-1
reproducer this row descends from used `isAlive=true` with `activity=exited` and expected a
*second launch* pre-fit-2; the r9 oracle inverts the expectation without naming the changed
probe premise.

**Required:** state the pin answer in T-7.3 (e.g. the pin answers `pane_not_found`, so the
block is kind `unproven`; or the pin answers `alive` and the block comes from a stated
R-row failure — but no R-row fails for the record as described, so the former is the
coherent pin). One-line fix; no design change.

### m-2 — CLI candidate split leaves the no-`runtimeName` parseable handle unrouted

**Design:** §5.3.5 step 3 vs §5.3.3 G1 rows 2–3. **Code where it applies:**
`packages/cli/src/commands/start.ts` (new step-3 split; today's fallback helper is
`recordRuntimeName`, fit-1 tip `start.ts` via `registry.get("runtime", ...)` with project
fallback) and `packages/core/src/session-manager.ts` (new `findReusableOrchestrators`).

Step 3 routes (a) "a stored handle whose `runtimeName` is in the set" to core, (b) "a stored
handle of another runtime" to today's liveness, (c) "no stored handle (also a handle that
does not parse)". G1 row 2 covers a handle that *parses but has no string `runtimeName`*
(`damaged` when the project selects a set runtime) and row 3 covers wrong-shape handles via
the `/"runtimeName"\s*:\s*"herdr"/` text match. A parseable handle without a string
`runtimeName` is neither (a) (`runtimeName` not in the set) nor (c) (it parses); by the
letter of step 3 it falls to (b), where today's `recordRuntimeName`-style fallback resolves
the *project's* runtime and probes through it — while G1 would select it as `damaged` and
block. Reachability is contrived (it needs a well-formed JSON handle with a non-string or
absent `runtimeName`, plus a Herdr-selecting project for the divergence to matter), and the
failure direction is reuse-by-probe versus block, so this is minor; but the split predicate
and the G1 predicate should be the same predicate.

**Required:** route by G1 selection, not by parsed `runtimeName` alone: any stored handle
that G1 would select (unparseable, wrong shape, missing/non-string `runtimeName`, or
herdr-matching text while the project selects a set runtime) goes to core (a); only a
well-formed handle whose `runtimeName` names a registered runtime outside the set takes the
(b) path. Add one T-7.9 sibling: parseable handle without `runtimeName` on a Herdr project
→ core, `damaged`, zero calls on the handle.

### m-3 — 5.2.4 does not scope steps 6a–7b to orchestrator vs worker and damaged handles

**Design:** §5.2.4 (applies "for a record whose create runtime is in the set") vs §5.3.1
("restore of an orchestrator record" takes A; "worker restores do not"). **Code where it
applies:** `packages/core/src/session-manager.ts` restore `:4286-4646` (fit-1 tip: step 7
stop guarded by `if (session.runtimeHandle)`, step 8 `:4516-4549`, step 9 `:4552-4569`,
step 10 `:4571-4613`).

Three sub-cases are implementable but unstated: (i) a *worker* Herdr restore performs the
6b copy-back check and the 7a transition write (deviation 3 says "also for a worker
restore") with **no A** — state that explicitly, with the record-lock + launch-identity
compare as the only atomicity; (ii) a restore whose old handle does not parse: step 7 has
no `RuntimeHandle` to dispatch (today's `if (session.runtimeHandle)` skips the stop when
the parsed handle is absent) — state that the transition then overwrites the damaged text
with P directly; (iii) 6a's "no probe" admission applies to orchestrator records only.

**Required:** three sentences in 5.2.4 scoping 6a (orchestrator only), 6b/7a (without A for
workers), and the damaged-handle step-7 skip. No behavior change; T-7.26 already covers the
orchestrator path.

### m-4 — Settlement threading across the partial-handle write is implied, not specified

**Design:** §4.5 (table + "when that earlier write changes the launch identity (a partial
handle), the settlement compares the new identity") and §5.2.3 step 2
(`own.write({ ...partialRecord, ... })` then stop/keep). **Code where it applies:**
`packages/core/src/session-manager.ts` (new `settleOwnClaim(own, ownClaim)`; fit-1-tip
`keepUnconfirmedLaunch` `:1971-2011` takes no claim parameter today).

Two plumbings are left to the implementer: (i) after the 5.2.3 step-2 partial write, which
`own` does the subsequent `settleOwnClaim(own, ownClaim)` in `keepUnconfirmedLaunch`
compare — the pre-partial `own` (stale identity → settlement always `null`, claim leaked
until the dead-launcher path) or the refreshed `own` (correct)? The text says "the new
identity" but never names the refresh (`own = own.after(partialRecord)` or passing the new
identity explicitly). (ii) The post-create catches (§5.2.2: "pass `ownClaim` too, so that
`keepUnconfirmedLaunch` can settle") need a `rollback.ownClaim` field, but 5.2.3's
`rollbackLaunch` signature lists no such field.

**Required:** name the refreshed identity at each settle call (spawn/start success,
`keepUnconfirmedLaunch`, restore step-9 partial, restore step 12) and add `ownClaim?` to
the `rollbackLaunch`/`keepUnconfirmedLaunch` rollback argument. Test cover already exists
(T-4.16–T-4.18); assert in T-4.17 that the kept record carries no claim *and* the partial
handle (fails if the stale identity is compared). No behavior change.

## G against the fit-1 guard gaps

Each gap the two fit-1 code reviews name, and where r9 closes or names it:

| Fit-1 gap | r9 state | Section |
| --- | --- | --- |
| sol M-1: `killed` record whose pane answers alive passed over (isolated second launch) | **Closed** (`not-reused`, terminal status; control oracle inverted) | 4.7 R6, 5.3.10 (2.2 item 12), T-7.1/T-7.4b |
| sol M-1: `working` record with `activity=exited` passed over | **Closed by construction** (G ignores `activity`; R7 probe decides) subject to new m-1's oracle fix | 4.7, T-7.3 |
| sol M-1: `done` (+ other terminal) records never probed/selected | **Closed** (selected regardless of status; blocked `not-reused`) | 5.3.3 G1, 5.3.10, T-7.1 |
| sol M-2: direct isolated core `spawnOrchestrator` reads no old record | **Closed** (G in core, both modes, every strategy) | 5.3.1–5.3.2, T-7.1/T-7.21 |
| Muse m-2 (fit-1): old Herdr handle probed through newly configured runtime | **Closed** (`runtimeForHandle` at every site; zero-wrong-runtime-call tests) | 4.6, T-7.8–T-7.8e |
| Muse m-3 (fit-1): handleless `unchecked` reuse | **Named limit** (L-2 + upgrade step; OQ-F10 (a) keeps CLI rule) | 5.3.5 step 3(c), 5.3.9 L-2 |
| Muse m-5 (fit-1): killed-alive isolated neighbor | **Closed** (same as sol M-1 row) | 4.7 R6, 5.3.10 |
| Muse §5 gaps 1–2 (direct isolated core; handleless in-flight) | **Closed** (G + P born in reservation with claim for unprepared agents too) | 4.4, 4.5, 5.3.2 |

## The relaunch merge (§6)

Re-verified against `git diff 3e366a01 7a20242f`: relaunch writes `launchToken`/
`launchTokenAt`/`launchPane` (`LAUNCH_TOKEN_KEY`, `LAUNCH_PANE_KEY`, `lastLaunchBinding`),
its own PID+start claim CAS with `settleOnce`, and refuses Herdr records; it does not touch
`restore`/`kill`. The §6 table is accurate on every shared key, function and path checked
(claim helpers, `spawn`/`spawnOrchestrator` success hunks, `types.ts`/`index.ts` additions,
CLI `session.ts`/`send.ts` hunks, docs). The second-landing rule (both test sets green,
naming relaunch's `relaunch.test.ts`/`relaunch-settle.test.ts` and fit-2's race tests) is
the right fence. `launchIdentityToken` (4.8) vs relaunch's `launchToken` naming split is
correct and the rename is applied consistently (no `launchToken(raw)` remains cited except
as history). Fit-2's claims are launch markers, not the R3 per-ID lease and not relaunch
M-6 — correctly disclaimed, with the transition write's compare form as the future M-6
hook. No fit-2 item was found to depend on RH (step-6 `pane get` is a check; G takes no
end-authority; confirmed-stop paths await a later RH-B).

## The fit-1 base: the 12 differences (§2.2)

Checked each against `9d51982b` (`git show` + `grep`/`sed`):

1. `herdr()` takes no `expectedId` (ID from `cliIdOf`) — confirmed (`herdr.ts`, `index.ts:178-200` wrapper).
2. No `isHerdrPinError` — confirmed absent (`grep` 0 hits); commit 1 adds it. ✓
3. `resolveHerdrEndpoint` reads no `compatible` — confirmed (`herdr.ts:253-284`, socket+running only). ✓
4. `running`-false text kept + new `compatible` text — confirmed current text at runtime-herdr `index.ts` create.
5. CLI interim has third part `isHerdrProbeTerminal` — confirmed (fit-1 tip `start.ts`, with `hasStoredHandle`/`recordRuntimeName`). ✓
6. Interim tests are the four files named — confirmed by name (`orchestrator-herdr-start.test.ts`, `fit-startup-interim.test.ts`, `start.test.ts`, `start-herdr-interim.test.ts`).
7. `lifecycle-manager.ts:214-222` untouched by fit-1 — confirmed (main tree comment still the old authoritative-negative text). ✓
8. `fit-reads.test.ts:189` session-form no-server text — confirmed (`noserver_never_workspace_create.cmd`: `...; run \`herdr session attach aohd-1\`...`), correctly not-Q1. ✓
9. `fit-reads.test.ts:208` pane-run failure oracle — confirmed (expects `workspace close` + plain error today). ✓
10. Root pane outside grammar → plain "no usable pane" — confirmed (create, no pane call). ✓
11. Interim probes through project's runtime — confirmed (core `:2509`/`:2589` pass `plugins.runtime`; only `handle.runtimeName` classifies). ✓
12. Killed-alive pass-over pinned by test — confirmed (fit-1 `start.test.ts` oracle; sol M-1 reproducer). ✓

No fit-1 export or behavior that fit-2 uses was found missing from §2.1 (reader, IDs,
no-server mapping, grammar, endpoint/invocation/pins, process readers, destroy refusal,
interim guard shape, test helpers, interim tests — each re-verified at the cited lines).

## Implementability

- **File list (17):** arithmetically complete — `runtime-errors.ts` (new), `types.ts`,
  `index.ts`, `herdr.ts`, `metadata.ts`, `delivery-lock.ts`, `session-manager.ts`,
  `runtime-stop.ts`, `lifecycle-manager.ts` (comment), runtime-herdr `index.ts`, CLI
  `send.ts`/`start.ts`/`spawn.ts`/`session.ts`/`status.ts`, `lib/preflight.ts`,
  `doctor.ts` (comment). Every behavior in §§4–5 maps to a listed file
  (`launchIdentityToken`→`metadata.ts`+`index.ts`; `admissionLock`→`delivery-lock.ts`;
  `findReusableOrchestrators`→`session-manager.ts`+`types.ts`; kill option→`types.ts`+
  `session.ts`; F-9 hint/token→`status.ts`; preflight→plugin+`spawn.ts`+`lib/preflight.ts`).
  `status.ts`/`metadata.ts`/`lifecycle-manager.ts` deltas vs r8 explained (2.2 item 7).
  No agent-plugin change needed (verified: no fit-2 path calls agent plugins differently).
- **Oracles:** every changed-oracle table checked plausible against today's code
  (create call indices +1 for the new `pane get`; `compatible` fixtures exit-0 with
  `compatible:false`; interim-test migration to `OrchestratorStartBlockedError` + M).
- **Tests can fail before fit-2:** the D2 list is the right non-vacuity discipline (r8
  subject rule→T-7.21c; core reuse→T-7.27/28; `settleOwnClaim`→T-4.16–18; transition +
  A-release→T-7.26b/c; P→T-4.15/T-7.20; probe-outside-A→T-7.29; Q→T-4.1b/3b;
  dispatch→T-7.8–8e; token/retire→T-9.6/8a). With new m-1 applied, T-7.3 joins it.
- **8 commits green:** order respects API-before-use (commit 1: error types, set constant,
  `preflight?`, create doc, Q, `isHerdrPinError`, token, `admission` kind, exports). The
  commit-3 interim-oracle claim ("no existing test meets that case with herdr") is
  consistent with the four interim files' Herdr-specific cases. Per-commit green is
  unproven until implementation (same caveat as both r8 reviews).
- **Size L** (~1,750 product + ~3,400 test lines): plausible for the mechanism
  (admission+G ≈ 500, F-4+claims ≈ 450); the r8→r9 delta (+core reuse decision, +settlement
  rows, +status, +subject tests) accounts for the growth from 1,400/2,600.

## Facts spot-checks (first-hand reads)

Code (fit-1 tip `9d51982b` unless noted; `main` worktree where stated):

1. `readHerdrCliFailure` exact form (`herdr.ts:91-122`): exit-1/no-signal/`killed!==true`/
   empty-stdout/one-line/`id`+`error`/expected-ID/non-empty-code — as §2.1 states. ✓
2. `HERDR_CLI_IDS` keyed by first two words (`herdr.ts:52`) incl. `pane run → cli:request`. ✓
3. `resolveHerdrEndpoint` validates binary/socket/boolean-`running`, reads no `compatible`. ✓
4. `herdrInvocationFor` both-pins/neither-pins/`HerdrPinError`, zero calls otherwise. ✓
5. `recordNamesRuntime`/`recordMayOwnRuntime` (`session-manager.ts:1671-1699`): empty-ID
   P-vs-P match + handleless true — §3.3 correction verified. ✓
6. Reservation atomicity (`metadata.ts:900-924`): `mkdir -p` then record-lock then `link`;
   `recordLockName` realpath-else-lexical (`:234-241`). ✓
7. Interim core guard (`session-manager.ts:571-603`): Herdr `false`/no-server → throw
   (neither reuse nor replace); project runtime passed at `:2527`/`:2588`. ✓
8. `keepUnconfirmedLaunch` (`:1971-2011`): 600-char cap, claim kept today (fit-2 settles). ✓
9. `SETTLED_STATES` holds `blocked` (runtime-herdr `:71`); `isAlive` rejects empty/
   off-grammar IDs with no call, `false` only `pane_not_found`/other-terminal, no-server
   rejects (`:626-646`). ✓
10. `openCodeHolderReason` (`:1072-1140`): launch-keys-no-handle dead holder (`:1087`),
    empty-ID handle unknown (`:1097`). ✓

Fixtures (`development/artifacts/herdr_095_live_check/`):

11. `r9_cli_forms_log.txt` (both sections, read in full): `pane run` vs protocol-23 ping →
    exit 1 `cli:request` `protocol_mismatch` "older than server protocol 23", 1 ping-only
    connection; protocol-19 control with the "newer …" text. Supports Q2 for `pane run`. ✓
12. `r9_strace_connects.txt` (read in full): 2 `connect()` lines, both `AF_UNIX`. ✓
13. `r9_admission_subject_check.txt` (read in full): symlinked parent — r8 two lock names,
    r9 one; `ENOTDIR`-as-component and dangling-symlink refusals (r9) vs lexical fallback
    (r8). Supports 4.9 + D2 premise. ✓ (Script `r9_admission_subject_script.txt` read;
    pure `node:fs/path/crypto`, no product import — measurement claim credible.)

`git show 258d85bf -- development/0004_running_ao_on_the_herdr_runtime.md`: diff changes
only fit-1/fit-2 pointers and the r9 `pane run` fact — as the report states. No fixture
proves server-imitated Q1/Q2 text (R-Q stays unmeasured by design, OQ-F7).

## Open questions OQ-F4–OQ-F12

| OQ | View |
| --- | --- |
| **OQ-F4** mismatch: (a) block | **Agree (a).** Reuse through the other runtime would keep a launch alive that the new runtime can neither see nor stop; T-7.8's zero-call assertions pin the safe direction. |
| **OQ-F5** send to kept failed launch: (a) no special policy | **Agree (a)** with the r9 wording fix. The check-then-send race is inherent (separate calls, RH B-2 open); quarantining would be a new feature. T-4.14 pins the three cases. |
| **OQ-F6** no-lock platform: (a) refuse start/restore | **Agree (a).** G without exclusion is not G. Reuse-only without A (fail-safe: reuse ≠ second launch, token-bounded) is the coherent companion. |
| **OQ-F7** R-Q residual: (a) qualify Q0/Q1/Q2 | **Agree (a)** conditional on explicit owner acceptance of R-Q. Q1 exact-full-message vs Q2 prefix is now precisely bounded; the imitator scenario needs exact-string forgery through the F1 envelope. Else (b). |
| **OQ-F8** F-9 token: (a) required | **Agree (a).** Enforces the inspection-to-command race guard for all AO-recorded changes; the unrecorded-change residual is honestly stated. |
| **OQ-F9** (new) subject: (a) canonical | **Agree (a).** Invariant across first `mkdir` (measured), refuses rather than silently forking on `ENOTDIR`/`EACCES`/`ELOOP`/dangling links. R-A (third-party swap mid-operation) is irreducible without OS-level atomicity — correctly left residual, not sold as closed. (b) reintroduces the M-1 fork by spelling; (c) serializes unrelated state roots. |
| **OQ-F10** (new) handleless CLI candidates: (a) today's rule | **Agree (a)** as the conservative interim **only with the L-2 upgrade step treated as mandatory**: a pre-fit-2 crashed handleless launch otherwise pins the project on "Using existing orchestrator" forever (it can never become alive). Name that consequence in the upgrade step. |
| **OQ-F11** (new) order vs relaunch: (b) build now | **Agree (b).** No semantic dependency (relaunch refuses Herdr; fit-2 does not complete R3/M-6); waiting would stall safety fixes on an unrelated review queue. The second-landing rule is enforceable as stated. |
| **OQ-F12** (new) size: (b) split into fit-2a/2b | **Agree (b).** Commits 1–4 (F-3/F-4/claims/dispatch) vs 5–8 (admission/CLI/F-9/docs) are independently reviewable and the two risky commits (3, 5) separate. Condition: fit-2a must document that the interim guard still stands and kept-failed launches retire by hand until 2b (the design states this — keep it in the split plan, not just the design). |

Owner decisions OQ-F1 (b), OQ-F2 (a), OQ-F3 (b) are applied, not reopened. No undecided
recommendation is treated as approval.

## What was found correct

- The M-1 composition (canonical subject + fixed-per-operation + rechecks + bounded
  under-A work + named R-A) closes sol M-1 with evidence, not assertion.
- The M-2 composition (one core decision, claim-kept launch never reused, token-keyed
  revalidation, real-core CLI race tests) closes sol M-2 including isolated candidates.
- The M-3 composition (owner-aware settlement on every end path, warn-and-keep on
  write failure, resident-process tests) closes sol M-3 for all three operations.
- Rule Q keeps its measured shape with the exact Q1/Q2 boundary and the named R-Q trust
  limit; pane-run Q still retains the workspace.
- Dispatch covers every old-record site with per-site missing-plugin semantics and
  zero-wrong-runtime-call tests; mismatch blocks.
- F-9 follows the review-r7 safeguard list with the token race guard, conditional retire
  write, per-checkpoint replacement tests, and the damaged-record by-hand path.
- Residuals are honestly bounded (R-A, R-Q, hidden-server attestation, L-1–L-5, W-4, RH).

## Cleanup and verification

- No `node`/`pnpm`/`ao`/`gh`/network/tmux/herdr/agent/model process was started by this
  review; no `/tmp/aofr9m` directory was made (only the marker file).
- Final `ls -la --time-style=full-iso ~/.ao/bin` byte-equal to the initial listing (same
  four entries, sizes, permissions, 2026-10-16 mtimes).
- Cleanup scan, run exactly as required:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr9m-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed (live-fleet paths only; no review command wrote AO state — no `ao` ran, and no
product code was executed):

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
```

Their contents and other sessions' panes were not read; the unchanged-state claim is
confined to files this review controlled. No review-owned process remains (none was
started); the protected workers/sessions/panes were not touched; no kill/pkill was run.

- Worktree writes: only this review file and the required `.agent_report.md`;
  `.agent_task.md` supplied externally, unchanged. `git diff --exit-code -- packages docs
  .github agent-orchestrator.yaml` passes (no output). No build/test was run (review-only).
