LAND-WITH-CHANGES

Outstanding: **0 blocking, 1 major, 0 minor**. The F-9 refusal defect, the admitted-read error mapping, the comment and the other coverage fixes are verified. Sol r1 M-4 / Argon r1 M-1 remain partly open: three subject-check call sites can still be omitted while all 510 changed-file tests pass. Each added independent use-site probe catches its omission. No new product defect was found. All required final gates pass, the expected red set is unchanged, and merge-tree has no conflicts.

# Herdr fit-2b r2 landing check (sol61), 2026-10-24

Range 13f982c2..66dff58c, owner decision 30 (1). Independent landing check complete. Only this new review and the explicitly required report are written in the worktree. All builds, probes and mutants use offline scratch archives; no network, real-config AO command, agent or Herdr server, commit, push or PR is authorized.

Initial receipts:

```text
66dff58c docs(core): correct the agent sentences of the authoritative runtimes comment
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

## M-1 — Three subject-check use sites remain unguarded (Sol r1 M-4 / Argon r1 M-1 partly open)

The new tests protect five of the eight call sites: after mkdir, first project reservation, isolated reservation, archive copy-back and restore transition. Removing each fails its corresponding new test. The remaining calls in `packages/core/src/session-manager.ts` are:

- :3397, the existing-directory check in restore/reuse-only.
- :4119, the project reservation retry after a concurrent non-set runtime answers dead.
- :4123, the project reservation retry when the concurrent record has no usable handle.

Removing any one of these calls builds successfully and passes all 510 original scenarios across the sixteen fit-2b changed test files, including the r2 additions. The note explicitly requires one mutant per subject-check use site, and design 4.9 requires the operation's fixed subject at these decisions/writes. This leaves the original combined coverage finding partly open. Product code at all three sites is correct; no new product defect is claimed.

Added independent scratch schedules:

1. Reuse-only: at lock-held, move the sessions directory and leave a symlink at its pathname. Correct code refuses admission-path before G1. Omitting :3397 returns a successful empty reuse result under a lock for the earlier subject.
2. Project start: make only the first reservation return null and install an ordinary mock-runtime orchestrator record. During its liveness probe, move the directory and leave a symlink, then answer false. Correct code refuses at :4119 before the second reservation. The mutant does not.
3. Project start: make the first reservation return null after installing a handleless record and moving the directory with a symlink left at its pathname. Correct code refuses at :4123 before retrying. The mutant does not.

These are changes before the omitted use-site check, not the accepted R-A window between the final check and its write. The first-reservation failure is a scratch metadata wrapper; no real runtime, server or other session is involved. All three added probes pass unmodified 66dff58c. Under each sole-call deletion, exactly its probe fails and the other two pass:

```text
existing-dir: original changed tests 510 passed/0 failed; build exit 0; added probes 2 passed/1 failed
REVIEW remaining subject use sites REVIEW reuse-only checks the existing directory after getting A
retry-dead: original changed tests 510 passed/0 failed; build exit 0; added probes 2 passed/1 failed
REVIEW remaining subject use sites REVIEW retry after dead concurrent runtime checks subject before reservation
retry-no-handle: original changed tests 510 passed/0 failed; build exit 0; added probes 2 passed/1 failed
REVIEW remaining subject use sites REVIEW retry with no concurrent handle checks subject before reservation
Each original-case list is nonempty and includes T-9.8a and T-7.27; each added failing list contains its corresponding REVIEW use-site case.
```

Required before closure: add these three call-site schedules to the subject-check tests and demonstrate each fails when only its corresponding call is omitted. No production change is needed for this finding.

## Disposition of every r1 finding

| Review finding | State and independent evidence |
| --- | --- |
| Sol M-1 (F-9 refusal mutates an unrepaired orchestrator) | **CLOSED.** `session-manager.ts:2265` introduces requireSessionRecordStrict; :4801 selects it only when a direct kill supplies a token. It iterates every configured project in the same order as the ordinary lookup, refuses absent/unreadable records, and never repairs. The record validation, token/owner/runtime/evidence checks write nothing before the existing retirement CAS. The two original scratch probes pass on built 66dff58c; three extra probes pass for second-project lookup, missing and unreadable records. Undoing the strict lookup makes the two new refusal tests fail while the ordinary-kill repair control still passes. Ordinary kill and cleanup retain requireSessionRecord; their behavior is unchanged. |
| Sol M-2 (post-hook reuse revalidation) | **CLOSED.** Three new schedules change only launchFailed, only restoredAt or only a live claim during awaited hooks. The correct code blocks/retries, leaves the replacement and creates nothing. The deciding-snapshot mutant fails all three. |
| Sol M-3 (retirement identity comparator) | **CLOSED.** Each of reservationId, runtimeHandle, tmuxName, createdAt and restoredAt is independently replaced during the evidence call. These are all five LAUNCH_IDENTITY_KEYS, with RESERVATION_KEY = reservationId. Each one-key comparator omission fails only its corresponding new test; all other per-key controls pass. The replacement remains byte-equal without retirement keys on correct code. |
| Sol M-4 (subject revalidation) | **PARTLY OPEN**, combined with Argon M-1. Five use sites are guarded, including independent first-project and isolated reservations. M-1 above documents the remaining three sites and passing wrong implementations. |
| Sol M-5 (CLI malformed-text routing) | **CLOSED.** Both malformed-text rows (explicit herdr and selection by project runtime alone) refuse damaged with no runtime call after the last list. The parse-required mutant fails both and leaves T-7.9b passing. T-7.9b's assertion/result block is byte-equal before/after the log-helper extraction. |
| Sol m-1 (stale process-check comment) | **CLOSED.** The comment now says all four agents reject failed checks and delegates Herdr failures/malformed answers to core. Both authoritative sets are unchanged. No agent behavior was changed. |
| Argon M-1 (subject equality use sites) | **PARTLY OPEN**, same combined finding as Sol M-4; no duplicate severity count. |
| Argon M-2 (post-hook reuse and G1 row 4) | **CLOSED.** The three hook schedules above guard reuse revalidation. New handleless/live-owner records in both modes fail the row-4-removal mutant: isolated mode would launch, project mode would return records-changed rather than the required in-progress block. |
| Argon M-3 (reuse-only locking and exhaustion) | **CLOSED.** Removing A only for reuse-only fails the busy-lock schedule; removing exhausted fails the changing-record/round-3 schedule. Each mutant leaves the other new case passing. |
| Argon M-4 (F-9 with no runtime plugin) | **CLOSED.** Adding `&& retireToken === undefined` lets the attested path skip the missing-plugin refusal and archive the record; the new test fails. Correct code keeps record/worktree/directory and makes no tmux call. |
| Argon m-1 (comment) | **CLOSED**, same comment correction as Sol m-1. |
| Argon m-2 (read errors in admitted strict re-reads) | **CLOSED.** `readAdmittedRecord` at :4021 maps both specified re-read sites to records-unreadable with the original error as cause. The post-hook Herdr case and outside-set project-mode case both pass on r2 and fail on 13f982c2 with the bare filesystem error. Removing the wrapper also fails the core case. For a tmux project this changes only the read-error classification/text; it retains the old runtime and creates nothing, as before. G1 already uses this typed refusal for the same read error. |

The reported twenty original guard-test additions are useful and non-vacuous. The author’s nineteen chosen mutants all fail; independently testing every subject call additionally finds the three surviving omissions above. The fix is incomplete rather than a regression in the new product code.

## Mutation receipts

Each mutation ran alone in an archive of 66dff58c with a successful core or CLI build before its tests. Source was restored between mutants. The subject rows omit one call only; the noop row omits the entire function body. Nonzero test exits in this table are intentional. Correct code passes all affected original test files (28 core, 153 runtime-herdr, 26 CLI). The sixteen-file runs for the three survivors pass 81 core + 178 runtime-herdr + 251 CLI = 510.

```text
mutant | build exit | test exit | passed | failed
strict-read-undo | 0 | 1 | 1 | 2
post-hook-snapshot | 0 | 1 | 0 | 3
retire-without-reservationId | 0 | 1 | 4 | 1
retire-without-runtimeHandle | 0 | 1 | 4 | 1
retire-without-tmuxName | 0 | 1 | 4 | 1
retire-without-createdAt | 0 | 1 | 4 | 1
retire-without-restoredAt | 0 | 1 | 4 | 1
subject-noop | 0 | 1 | 0 | 5
subject-after-mkdir | 0 | 1 | 4 | 1
subject-before-project-reservation | 0 | 1 | 4 | 1
subject-before-isolated-reservation | 0 | 1 | 4 | 1
subject-before-copyback | 0 | 1 | 4 | 1
subject-before-transition | 0 | 1 | 4 | 1
subject-existing-dir | 0 | 0 | 5 | 0
subject-project-retry-dead | 0 | 0 | 5 | 0
subject-project-retry-no-handle | 0 | 0 | 5 | 0
cli-needs-json | 0 | 1 | 1 | 2
g1-without-row4 | 0 | 1 | 0 | 2
reuse-without-lock | 0 | 1 | 1 | 1
reuse-without-exhausted | 0 | 1 | 1 | 1
retire-without-plugin | 0 | 1 | 0 | 1
admitted-read-bare | 0 | 1 | 0 | 1
```

Independent D1/lookup probe receipts (new tests copied into built 13f982c2; independent lookup probes use built r2):

```text
d1-core: passed=25, failed=3
r2 argon m-2: a read error in today's project-mode branch refuses as G1 does a live mock record that cannot be read after its probe: records-unreadable; nothing created
AssertionError: expected false to be true // Object.is equality
Herdr fit-2 F-9 with an OpenCode session (T-9.8c, T-9.10) r2 sol M-1: a refusal of an orchestrator record changes nothing (5.4.2 step 1) a token of another launch: refused; the record byte-equal, no stop, nothing archived or removed
AssertionError: expected 'worktree=/tmp/aof2bs2/tmp/ao-test-sta…' to be 'worktree=/tmp/aof2bs2/tmp/ao-test-sta…' // Object.is equality
Herdr fit-2 F-9 with an OpenCode session (T-9.8c, T-9.10) r2 sol M-1: a refusal of an orchestrator record changes nothing (5.4.2 step 1) its pane runs: refused at step 7; the record byte-equal, nothing archived or removed
AssertionError: expected 'worktree=/tmp/aof2bs2/tmp/ao-test-sta…' to be 'worktree=/tmp/aof2bs2/tmp/ao-test-sta…' // Object.is equality
d1-herdr: passed=152, failed=1
r2 argon m-2: a read error at the reuse re-read refuses as G1 does the record cannot be read after the hooks: records-unreadable; no reuse, no create
AssertionError: expected false to be true // Object.is equality
d1-cli: passed=26, failed=0
own-lookup-probes: passed=5, failed=0
remaining-correct: passed=3, failed=0

```

## Scope, oracles and gates

Own reading covered all four commits before the author's r2 report. The diff is exactly eight paths: two product files (`session-manager.ts`, the lifecycle comment) and six existing test files. No old assertion was removed or changed. T-7.9b moves only its ordered-log setup to a helper; its assertion/result block is byte-equal (both blocks nonempty and include expect(inside) and the post-list zero-call assertion). All other test changes are appended cases or harness hooks/imports used by them. No agent, CLI product, metadata protocol, runtime-stop or publication behavior changed.

Every pnpm/node/test parent used `env -i HOME=/tmp/aof2bs2/home TMPDIR=/tmp/aof2bs2/tmp PATH=/tmp/aof2bs2/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`. PATH is a link directory with cached pnpm 9.15.4, required utilities (including jq), a gh stub accepting only --version/auth status, and a tmux shim calling `env -u TMUX /usr/bin/tmux -L aof2bs2-tests "$@"`. Explicit test -S paths take precedence. No agent or herdr binary, npm, npx or /usr/bin directory is on PATH.

- Frozen offline install with the cached v3 store, root build, typecheck and lint: exit 0. Lint has exactly five known warnings: CLI spawn.ts:332, core activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:3880/:3887, plus the existing ESLint ignore-file migration notice.
- Full `pnpm -r --no-bail test`: exit 0 on the first run. Core 1878 passed + 1 expected fail; runtime-herdr 341; CLI 491. Claude Code 368; Codex 318; Gemini 99; OpenCode 365; runtime-tmux 116; worktree 85; scm-github 140 + 5 skipped; tracker-github 42; notifier 26; integration-tests 91 + 24 skipped. Private-tmux cases ran, with no skips in runtime-tmux or agent packages. Counts match the author's report exactly.
- Relative to 13f982c2: core +9 (three F-9 lookup tests, five subject-site cases, one admitted-read-error case); runtime-herdr +14 (three post-hook cases, two G1 row-4 cases, two reuse-only cases, five identity-key cases, one missing-plugin case, one admitted-read-error case); CLI +2 malformed-text cases. Other counts are unchanged. The retained-failure red sets were rerun on both archives rather than inferred from the prior review.
- All fifteen relaunch files pass independently:

```text
relaunch-agent-claude-code.json: files=3 passed=49, failed=0, pending=0
relaunch-agent-codex.json: files=1 passed=10, failed=0, pending=0
relaunch-agent-gemini.json: files=1 passed=10, failed=0, pending=0
relaunch-cli.json: files=3 passed=56, failed=0, pending=0
relaunch-core.json: files=4 passed=133, failed=0, pending=0
relaunch-runtime-tmux.json: files=3 passed=47, failed=0, pending=0
```

`SAME_ID_DEFECTS=red`: the two failure lists are nonempty and each includes R2 B-1 and R3 F-5. Their full-name sets are equal: 21 failures, R2 15/R3 6. The nonzero exits are expected. Receipt:

```text
red-base-agent-claude-code.json: failures=1
red-base-agent-codex.json: failures=1
red-base-agent-gemini.json: failures=1
red-base-agent-opencode.json: failures=2
red-base-cli.json: failures=0
red-base-core.json: failures=1
red-base-runtime-herdr.json: failures=0
red-base-runtime-tmux.json: failures=11
red-base-workspace-worktree.json: failures=4
base: total=21, R2=15, R3=6
red-tip-agent-claude-code.json: failures=1
red-tip-agent-codex.json: failures=1
red-tip-agent-gemini.json: failures=1
red-tip-agent-opencode.json: failures=2
red-tip-cli.json: failures=0
red-tip-core.json: failures=1
red-tip-runtime-herdr.json: failures=0
red-tip-runtime-tmux.json: failures=11
red-tip-workspace-worktree.json: failures=4
tip: total=21, R2=15, R3=6
Both failing lists are nonempty with R2 B-1 and R3 F-5 sentinels; full name sets equal.
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, isAlive of the old launch answers false
[same-id R2] B-1: two launches of an ID in the same second destroy of the first launch keeps a replacement of the ID that started in the same second
[same-id R2] B-1: two launches of an ID in the same second isAlive of the first launch answers false while a same-second replacement of the ID runs
[same-id R2] B-2: a replacement between the create and its launch keys create: a replacement of the ID made directly after the create command never receives the first launch's keys
[same-id R2] B-5: another server answers at the recorded socket path isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
[same-id R2] B-5: another server answers at the recorded socket path isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
[same-id R2] D-B: a call finds the tmux server only through its environment destroy from another server's environment does not end that server's session of the same name
[same-id R2] D-B: a call finds the tmux server only through its environment isAlive answers true for a live session when the caller's environment names another server
[same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the codex pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the gemini pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the opencode pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] F-5: destroy by name ends another launch of the same name destroy keeps a newer session of the same name that another launch created
[same-id R2] F-7: a hidden socket of a running server reads as no server isAlive does not report 'no server' while the recorded server process still runs
[same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree create does not remove a worktree that another launch made at the path during the checkout
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files restore: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files spawn: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get a rollback during another spawn's session.get does not remove the session that the spawn then stores
[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime
[same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it kill and restore of one ID: the active record at the end still has its worktree
```

`gitleaks git --log-opts=c6d80383..66dff58c --redact`: exit 0, eight commits scanned, no leaks found. `git merge-tree --write-tree --merge-base c6d80383 main 66dff58c`: exit 0, tree 6cb03c2ef451954a148064476360df3e5b5710a3. Local main is fc6cea979fadb481f9481f3ed011e6e7e755629e and changes only development documentation after c6d80383. Conflicting paths: none. No ref was written. Intermediate per-commit gates were not rerun; the final gates above were run independently.

## Reproducing the remaining coverage gap

In an offline archive of 66dff58c, build core, then delete only one of :3397, :4119 or :4123 from `packages/core/src/session-manager.ts` and rebuild core. Run the sixteen files from `git diff --name-only c6d80383 66dff58c -- '*test.ts'` in their respective packages: all 510 pass for each sole omission. Restore the source and rebuild between mutants.

For the distinguishing schedules, append the following to core `src/__tests__/session-manager/orchestrator-admission.test.ts`. It reuses that file's helpers. The metadata wrapper makes exactly one reservation fail after the callback; it delegates every other reservation to the real function. These probes are scratch-only; they do not alter a real configuration, pane or runtime. Correct code passes all three; each sole omission fails only its corresponding probe.

```ts
const reviewReserve = vi.hoisted(() => ({ once: null as null | (() => void) }));
vi.mock("../../metadata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../metadata.js")>();
  return { ...actual, reserveSessionRecord: (...args: Parameters<typeof actual.reserveSessionRecord>) => {
    const once = reviewReserve.once;
    if (once) { reviewReserve.once = null; once(); return null; }
    return actual.reserveSessionRecord(...args);
  } };
});
beforeEach(() => { reviewReserve.once = null; });
describe("REVIEW remaining subject use sites", () => {
  it("REVIEW reuse-only checks the existing directory after getting A", async () => {
    config.projects["my-app"]!.runtime = "herdr";
    const { registry, runtime } = herdrRegistry();
    let moved = "";
    const sm = createSessionManager({ config, registry, admission: { onStage: async (stage) => {
      if (stage === "lock-held" && !moved) moved = moveSessionsDir();
    } } });
    const err = await sm.findReusableOrchestrators?.("my-app").catch((e: unknown) => e);
    expect(moved).not.toBe("");
    expectSubjectMoved(err, moved);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("REVIEW retry after dead concurrent runtime checks subject before reservation", async () => {
    const project = config.projects["my-app"]!;
    project.runtime = "herdr";
    project.orchestratorWorkspaceMode = "project";
    mkdirSync(project.path, { recursive: true });
    const { registry, runtime } = herdrRegistry();
    vi.mocked(runtime.create).mockResolvedValue(HERDR_HANDLE);
    let moved = "";
    reviewReserve.once = () => killedOrchestrator({ runtimeHandle: JSON.stringify(makeHandle("review-old")) });
    vi.mocked(mockRuntime.isAlive).mockImplementation(async () => {
      if (!moved) moved = moveSessionsDir();
      return false;
    });
    const sm = createSessionManager({ config, registry });
    const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
    expect(moved).not.toBe("");
    expectSubjectMoved(err, moved);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
  });
  it("REVIEW retry with no concurrent handle checks subject before reservation", async () => {
    const project = config.projects["my-app"]!;
    project.runtime = "herdr";
    project.orchestratorWorkspaceMode = "project";
    mkdirSync(project.path, { recursive: true });
    const { registry, runtime } = herdrRegistry();
    vi.mocked(runtime.create).mockResolvedValue(HERDR_HANDLE);
    let moved = "";
    reviewReserve.once = () => { killedOrchestrator(); moved = moveSessionsDir(); };
    const sm = createSessionManager({ config, registry });
    const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
    expect(moved).not.toBe("");
    expectSubjectMoved(err, moved);
    expect(runtime.create).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
  });
});

```

## Cleanup

Own-process scan after the last test (scratch HOME or cwd; scanner and its parent excluded):

```json
[]
```

Explicit private-server check, through the scratch shim:

```text
no server running on /tmp/tmux-44402/aof2bs2-tests
private tmux list exit=1
```

No process was manually signalled. Test harnesses cleaned their own children/private sockets. No command was sent to the default tmux server or another session/pane/worktree.

The required scan was `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2bs2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'`. Every printed path:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-86
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
```

The first two are concurrent Nexus session/lifecycle activity. The last four are the agent-orchestrator sessions directory and the ao-86, ao-orchestrator and ao-73 records, updated by the owner's orchestrator/lifecycle activity. No review command authored these real-state writes: all node/pnpm/test parents used the cleared scratch environment and no real-config AO command ran. Exact syscall-writer PIDs were not instrumented; these are project/path attributions. No protected worker or session was acted on.

The final ~/.ao/bin listing is byte-equal to its initial listing (entries, sizes, modes and mtimes; not a content-hash claim). The r1 review remains byte-equal to its published d9794f3e copy. The tracked diff is empty. Only this r2 review and the explicitly required .agent_report.md were written in the worktree; the notes/task were externally supplied. No source edit, branch change, commit, push, PR, network operation, stash or worktree creation occurred.

```text
ao-bin listing compare exit=0
tracked diff exit=0
Untracked r1 review remains byte-equal to the d9794f3e copy.

```

Final removal check: /tmp/aof2bs2 and /tmp/aof2bs2-marker are absent; the stopped private socket was removed.
