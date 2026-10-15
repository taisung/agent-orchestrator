# I-2 blind review, round 1 — one OpenCode API helper, ID-based lookup, remove and interrupt

- Range: `git diff c949f902 1c2a93b6` (`568cdc5a`, `f9c0d594`, `1c2a93b6`), HEAD `1c2a93b6`.
- Reviewer: DeepSeek V4.1 Flash. Reviewed from source, tests and my own runs; the author report was
  read only after item 1 to 6 of the brief.
- Environment: Node v25.7.0, pnpm 9.15.4, OpenCode `2.0.29` (global service PID 4171365). Writes ran
  against an isolated store (`XDG_*` under `/tmp/opencode/ao17-iso`, port 49517, service PID 4190924,
  `server.info` checked to differ from the global PID).

## Verdict

**NOT-LAND-SAFE**

One major: requirement A4, sentence 2 (a refused binary must name the version problem, "not only the
missing mapping") is not met in the restore path, and both the commit message and a code comment assert
that it is. The helper, the ID-only lookup, remove and interrupt are correct and the rest of the
increment matches the brief.

---

## Findings

### M-1 (major) — the A4 version message is unreachable when the mapping is missing

- Files: `packages/core/src/session-manager.ts:2426-2436` (throw) and `:2543-2544`
  (`getRestoreCommand` call); `packages/plugins/agent-opencode/src/index.ts:637-645`.

`restore()` throws the A4 `SessionNotRestorableError` at `session-manager.ts:2432` when
`selectedAgent === "opencode"` and no valid `opencodeSessionId` is stored, and it returns **before**
reaching `getRestoreCommand` at `:2544`. `getRestoreCommand` is the only place the version probe runs for
restore (`index.ts:643`), and the only caller of `getRestoreCommand` in the tree is core restore
(`grep -rn getRestoreCommand packages --include=*.ts`, source only). So on a `<2.0.29` binary **with no
stored ID** the operator sees the missing-mapping message and never the version problem. The comment at
`:2428-2431` ("The plugin's `getRestoreCommand` runs the I-1 version probe first, so a refused binary
still reports the version problem ... once the restore command is built below") and the `1c2a93b6`
commit body ("probes the version even when no ID is stored so a refused binary names the version instead
of only the missing mapping") both describe a path the code does not take.

**Reproducer** (fake `opencode` whose `--version` prints `1.18.35`, `api session.get` answers a valid
record; standalone harness over the built core + plugin, config with `agent: opencode`):

```
# stored opencodeSessionId present:
restore rejected after 69 ms: ao needs OpenCode 2.0.29 or later (found opencode v1.18.35)

# same session, no opencodeSessionId:
restore rejected after 1 ms: Session app-1 cannot be restored: no stored OpenCode session ID for
  app-1; run `ao session remap app-1` to re-discover it by exact title
```

The plugin unit test "version gate on restore > probes even when it finds no session, so a refused binary
names the version" (`index.test.ts:1916-1925`) passes only because it calls `getRestoreCommand` directly;
the integrated core path never calls it for that case. Note that the same throw also pre-empts the
fallback to `getLaunchCommand`, whose probe would have named the version.

Fix direction (author's choice): probe/refuse the binary before the A4 throw (for example call the
agent's version check from core, or run `getRestoreCommand`/`getLaunchCommand` and let the refusal
propagate before the mapping error).

### m-1 (minor) — `includeTitleDiscoveryForSessionId: true` is passed but ignored; orchestrator `delete` no longer cleans up by title

- Files: `packages/core/src/session-manager.ts:585-590` (signature + "it is ignored") and `:1503-1509`
  (caller in `spawnOrchestrator`, `orchestratorSessionStrategy === "delete"`, passes `true`);
  `packages/core/src/__tests__/session-manager/spawn.test.ts:1540-1553` (test changed to assert nothing
  is deleted).

The only caller that sets the flag still expects title discovery, and it is now a no-op: with
`delete`, only stored IDs are removed, so an OpenCode session whose ID is absent from metadata is no
longer found by `AO:<id>` title and leaks. This is a behavior change to a path outside the brief's
row 24 (reuse) and outside rows 1-4/7/8/23; the effect is a resource leak (safe direction), and the
test was rewritten to accept it rather than remove the dead parameter. Either honor the flag on the
`delete` path or delete the parameter and its caller's use, and say so in the commit. The author's own
report already lists the parameter as an open point, so this is severity-only.

### m-2 (minor) — the mock hides the real `interrupt` shape; the top-level branch is untested

- File: `packages/core/src/__tests__/session-manager/opencode-helpers.ts:118`
  (`{"data":{"interrupted":false}}`); helper handles both at `packages/core/src/opencode-api.ts:286-291`.

Measured on the isolated 2.0.29 service: `opencode api session.interrupt --param sessionID=<idle>` prints
`{"interrupted":false}` at the **top level** (exit 0), not under `data`. The mock emits the `data` shape,
so the top-level branch (`opencode-api.ts:289-291`) has no unit test and only my live run exercised it.
The other mock shapes match the real binary: `session.remove` prints nothing (204) and exits 0;
`session.get` on a removed ID prints `{"_tag":"SessionNotFoundError",...}` to stdout, `HTTP 404 Not Found`
to stderr and exits 1 (`opencode-helpers.ts:79-106`); error exit code 1. Add a top-level-shape case.

---

## Correct / verified

- **A1 helper** (`opencode-api.ts`): `execFile("opencode", args, …)` with an args array, never a shell
  string (`buildArgs:102-115`, call at `:134`); bounded timeout on every call (`:129`,
  `OPENCODE_API_TIMEOUT_MS = 10_000` at `:39`, override propagates from `get/list/remove/interrupt`);
  child stderr captured, never inherited (`execFile` pipes by default, comment `:137-138`, unit test
  `opencode-api.test.ts:113-123`); 404 → `null` (`isSessionNotFound:86-100`); every other error thrown
  with `cause` (`:165-168`, `:176-178`, `:184-188`); no `service.json` or password read anywhere. Every
  exported function's callers match the header policy — `getOpenCodeSession`: plugin `findOpenCodeSession`
  catches → JSONL/null (`index.ts:366-391`), reuse skips (`session-manager.ts:607-617`), restore
  propagates; `listOpenCodeSessionsByTitle`: remap propagates, spawn-time (row 23) catches;
  `remove/interrupt`: kill purge swallows (`:1795-1802`), cleanup records an error entry (`:1941-1947`).
- **A2/rows 5,6** (`index.ts:366-391`, `:637-655`): lookup and restore use `session.get` by the stored
  ID; no title search. Confirmed by the plugin tests and the `getActivityState`/`getSessionInfo` cases.
- **A3/rows 9,20,21**: `deleteOpenCodeSession` → `session.remove` with retries 0/200/600 ms
  (`session-manager.ts:91-113`); `kill --purge-session` → interrupt (swallow) then remove, by the stored
  ID only (`:116-127`, `:1787-1803`); `cleanup` archives only after a successful remove. With
  `{"interrupted":false}` (measured top level) the interrupt is ignored and remove still runs; when remove
  fails after its retries the error is swallowed and the AO session is archived without the cleaned
  marker, so a later `ao session cleanup` can retry (`:1799-1809`). Verified live: `remove` on a real ID
  exits 0 with no output; a second `remove` of the same ID returns the 404 shape and the helper treats it
  as success.
- **IDs come from the AO session's own metadata only** on every path to remove/interrupt/reuse/restore
  (`raw["opencodeSessionId"]` / `session.metadata`), never a title or substring search. The row-23
  spawn/orchestrator-start discovery still uses the exact-title helper and is the only remaining title
  path, as the brief requires.
- **Row 22 remap** (`session-manager.ts:2360-2386`): `session.list --param search=<title>` plus an exact
  title filter. Verified live on the isolated store: searching `AO:ao17-remap-1` returned `[]` while a
  session titled `AO:ao17-remap-1-extra` existed; searching `AO:ao17-remap-1-extra` returned that one.
- **Row 24 reuse** (`session-manager.ts:603-618`): first stored ID that still exists via `session.get`; a
  404 is not replaced by a title match, a timeout/other error skips the candidate. Covered by
  `spawn.test.ts` ("does not replace a gone stored ID with a title match on issue reuse").
- **A4 clause 1**: no stored ID → message names it and the repair command (verified in the M-1 reproducer;
  test `restore.test.ts:375-404`).
- **No change outside I-2**: plugin `getLaunchCommand` and `buildResumeCommand` extracted from both
  commits compare byte-identical; the plugin diff hunks touch only imports, the removed
  `parseUpdatedTimestamp`/`parseSessionList`, `findOpenCodeSession`, the `getActivityState` fallback and
  `getRestoreCommand`. The changed-file list is exactly the brief's section 3 set (no CLI, no
  `development/`, no config).
- **Scope and commits**: three conventional `feat(...)` messages, the WHY in each body, no
  `Co-Authored-By` trailer, no emoji, no issue number; `git branch -r --contains 1c2a93b6` prints nothing
  (D9).
- **Tests (D1-D9)**: I ran and judged them.
  - D1 helper unit tests cover success, 404→`null`, other error with `cause`, timeout with `cause`,
    cut-short exit-0 (`incomplete JSON`), empty-only-for-remove, stderr captured, bounded timeout — good.
  - D7 non-vacuity, scratch copy at `c949f902` (`git archive` + symlinked `node_modules`, new test files
    overlaid): core **20 failed | 611 passed** (7 files failed, including `opencode-api.test.ts` failing
    to import `../opencode-api.js`), plugin **9 failed | 150 passed**. The new tests are not vacuous.
  - D8 counts quoted below.
- **Tests check relations, not copied literals** where it matters: the helper tests assert `execFile` args
  contain `sessionID=`/`--param` (not a shell string), the delete-retry tests count 3 `session.remove`
  calls, and the exact-title test asserts which IDs survive a substring `search`.

## Measured, judged acceptable for this increment

- **Truncation (0010 §11.1), "check the JSON, no file"**: acceptable for I-2. On the global 2.0.29
  service, `session.list --param limit=200` = 89109 chars / 89200 B, `session.get` = 467 B,
  `server.info` = 139 B — all I-2 answers are small and far below 262144, and a 1 s busy event loop still
  returned the complete 89200 B. I-2 never calls `model.list` (458898 B), the large-answer case. A cut
  answer cannot parse as valid JSON: scanning every proper prefix of the real `session.list` answer, the
  only prefix that parsed was the full answer minus its trailing LF; for a single object root no proper
  prefix is balanced. `get`/`list` do not retry (only `remove` retries), but a truncated read becomes a
  thrown error, i.e. the caller's "unavailable" path, never a silent empty result.
- **Bounded time**: restore with a fake `opencode` whose `api` sleeps and whose `--version` answers
  2.0.29 rejected after **20087 ms** (two bounded 10 s calls; matches the author's ~21 s, better than the
  pre-I-2 ~40 s; D4). One `session.get` on the global service measured **160 ms**; with the default 30 s
  lifecycle poll (`lifecycle-manager.ts:1403`) that is ~160 ms per OpenCode session per poll — acceptable
  for I-2, worth revisiting in I-4 when `session.active` can be shared across sessions.
- **D8 summaries**: `@aoagents/ao-core` 653 passed (32 files); `@aoagents/ao-plugin-agent-opencode`
  159 passed and `typecheck` clean; integration package 104 passed | 15 skipped with `opencode` present
  and 99 passed | 20 skipped with `opencode` hidden from `PATH`; `pnpm lint` 0 errors, 5 pre-existing
  warnings (none in I-2 files: `cli/spawn.ts:339`, `core/activity-log.ts:91`,
  `core/plugin-registry.ts:232`, `core/session-manager.ts:1257`/`:1264`, all untouched); one full
  `pnpm test` exit 0 (1900 passed | 20 skipped).
- **Not chased**: `ao doctor`'s `FAIL launcher entrypoint is missing` is the stale
  `scripts/ao-doctor.sh:264` check, as the brief notes.

## Notes on the author's open points (severity only)

- 21 s restore with a hanging binary: bounded and improved; not a blocker.
- `interrupted` shape: real 2.0.29 answers top-level `{"interrupted":false}`; the helper handles it and
  the live run confirmed it — only the mock (m-2) is unfaithful.
- Unused parameter: see m-1.
