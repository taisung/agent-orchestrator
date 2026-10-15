# Review — CI cleanup, round 1: remove the dashboard parts of the onboarding test (`5ad7e1ce..0a81e224`)

**Reviewer**: DeepSeek V4.1 Flash (blind, round 1; peer lens Sonnet 5.5).
**Range reviewed**: `git diff 5ad7e1ce 0a81e224`, one commit `0a81e224` (`ci(integration): remove dashboard steps from onboarding test`).
**Files**: `tests/integration/onboarding-test.sh` (−101), `tests/integration/docker-compose.yml` (−9). Nothing else.
**Worktree HEAD**: `0a81e2246c9bb79231bfbcff929a472198b6b4c7` (verified `git rev-parse HEAD`).
**Date**: 2026-10-15.
**Method**: read the author brief, both pre-change files (`git show 5ad7e1ce:`), the commit and its diff, the full failed CI job log (`gh run view 38771289585 --log-failed`), the workflow, `Dockerfile`, `run-test.sh`, the config schema and its readers, and the author report (read last). Ran read-only checks D1–D6 in the worktree. No tracked file was edited, nothing committed or pushed.

## Verdict

**LAND-SAFE**

Every removed line is dashboard-, web-terminal- or browser-only; steps 1–5 and the summary are byte-identical; the script still ends with `Total onboarding time` and `exit 0`, so the job that failed at Step 6 should pass on the next push. The only two residual dashboard-era strings I could find are minor/cosmetic and were either mandated by the brief (`port: 9000`) or pre-existing and unrelated to this change. No blocker or major.

## Findings

### m-1 — `port: 9000` in the Step 4 fixture is dead dashboard-era config

`tests/integration/onboarding-test.sh:71` (`port: 9000`). The headless fork declares this field only as a deprecated, ignored legacy setting: `packages/core/src/types.ts:1017`

```
/** @deprecated Legacy dashboard setting; ignored by the headless distribution. */
port?: number;
```

and the schema keeps a default only for compatibility (`packages/core/src/config.ts:252`, `port: z.number().default(3000)`). A search for any reader (property access, destructuring) across `packages/core/src`, `packages/cli/src` and `packages/plugins` (excluding `__tests__`) returns no non-test consumer — the only remaining hits are test fixtures. So the line cannot affect the reduced job: the schema accepts a number and nothing reads it.

It is nonetheless the last dashboard string in `tests/` (D3 below), and the owner's ask is "clean up any dashboard-related CI", so it is arguably in scope. It was kept only because the author brief §2.1 said "Keep steps 1 to 5 unchanged", and the author flagged it explicitly. I agree with keeping it: changing a step-1–5 line would violate the explicit constraint for zero functional gain. **No action required**; if the owner later wants a zero-hit D3 grep, drop the single `port: 9000` line (and nothing else in Step 4). Minor.

### m-2 — "Upload test logs" artifact path never matches a produced file (pre-existing)

`.github/workflows/onboarding-test.yml:48-55` uploads `path: tests/integration/*.log` on failure, but neither `onboarding-test.sh` nor the compose service writes any `*.log` file — the test output only goes to stdout/stderr (captured by `docker logs`). On a failure the artifact is therefore empty or absent. This is not introduced by `0a81e224` (the upload step and the script's stdout-only output predate it) and the retention policy still works; it is listed only because the brief asked whether the workflow still "makes sense" after the change. It does, minus this pre-existing cosmetic gap. Optional fix: upload `${{ github.workspace }}` logs via `docker logs` redirection, or drop the step. Minor.

### m-3 — `version: '3.8'` still emits an obsolete-attribute warning (pre-existing, cosmetic)

`tests/integration/docker-compose.yml:1`. The failed run already showed `level=warning ... the attribute 'version' is obsolete` (`gh run view 38771289585 --log-failed`, first lines). The change left the key in place, which is correct under the brief's "remove only dashboard/terminal/browser lines" rule, but it remains avoidable noise. Minor, pre-existing.

### Note (not a finding) — `--no-dashboard` survives in source

`packages/cli/src/commands/start.ts:997` still registers a hidden `.addOption(new Option("--no-dashboard").hideHelp())`. This is a source file, outside the brief's allowed set (CI/test files only) and outside the owner's "dashboard-related CI" scope, so it is not a finding for this review — flagging it only so it is not mistaken for something the author should have removed.

## Item-by-item answers (brief §2)

**1. Only dashboard parts were removed?**

- **Step 6** (`ao start --no-orchestrator` as "dashboard" + 30 s `curl http://localhost:9000` wait loop + "Dashboard process died"). Dashboard-only. `--no-orchestrator` means "start the dashboard but not the orchestrator agent". The step's only assertions were against `localhost:9000`. Removed correctly.
- **Step 7** (`/api/sessions`, `/api/events` curls on `:9000`). Dashboard API only. Removed correctly.
- **Step 8** (`DIRECT_TERMINAL_PORT` 14801 `/health`). Web-terminal WebSocket only. Removed correctly.
- **Step 9** (tmux `test-project-orchestrator`, metadata file, `curl http://localhost:9000/sessions/...`). The tmux session and metadata file are fixtures for the dashboard page check; the asserted line is the dashboard session page. Removed correctly.
- **Step 10** (kill/kill -9 `$DASHBOARD_PID`, `pkill -f "node.*next.*dev"`, `pkill -f "tsx.*terminal"`). Teardown of the above; removed correctly (and it removes the only kill-by-name patterns, which the brief forbids introducing).
- **Compose `ports`** (`9000:9000` dashboard, `9001:14800` Terminal WS, `9003:14801` DirectTerminal WS). All browser/dashboard/terminal endpoints. Removed correctly.
- **Compose `shm_size: 2gb`** (comment: "for browser-based tests (future)"). Browser-only. Removed correctly.

**Did a removed step also check something the headless fork still ships?** Yes, two things, both covered elsewhere:

- `ao start --no-orchestrator` still exists (`packages/cli/src/commands/start.ts:998`) and is well covered by `packages/cli/__tests__/commands/start.test.ts` (many cases pass `--no-orchestrator`), which runs under `pnpm test` in `.github/workflows/ci.yml:41-53`.
- Step 9's tmux + metadata fixture covers the tmux runtime and metadata store, still shipped; covered by `packages/integration-tests/src/runtime-tmux.integration.test.ts` and `metadata-lifecycle.integration.test.ts` (run by `.github/workflows/integration-tests.yml:51`, `pnpm test:integration`).

So no unique headless coverage was lost, and the removed steps' real subject (the dashboard) no longer exists. No action.

**2. Steps 1–5, the summary, and the next run.**

Steps 1–5 are byte-identical to `5ad7e1ce` (verified by `diff` of lines 1–88 → empty, D4). The summary block and the `Total onboarding time` line (`onboarding-test.sh:100`) are untouched, and the script ends in `exit 0` (`:108`). In run `38771289585` (commit `70d19d70`) steps 1–5 all passed — Step 2 `Setup completed (19s)`, Step 3 `ao --version` → `0.2.2`, Step 4 config created, Step 5 validated — and only Step 6 failed (`Dashboard process died`), because `ao start --no-orchestrator` exits immediately in the headless fork while the loop polls `:9000`. With steps 6–10 gone, the container reaches the summary and exits 0, so `docker compose up --exit-code-from onboarding-test` returns 0. The CI run was at `70d19d70`; `git diff --stat 70d19d70..0a81e224` is `development/TODO_TRACKING.md`, `docker-compose.yml`, `onboarding-test.sh` only — no package or `setup.sh` code changed — so the passing steps 1–5 behavior is identical to the observed run. **Expected: pass.**

Named risks (all low, none introduced by this change): (a) `scripts/setup.sh` still runs a network `pnpm install` + build + global `npm link` in Step 2, so the job remains sensitive to registry/network flakiness; (b) the 15-minute job timeout is generous versus the ~20 s observed run; (c) the "Extract metrics" step greps `docker logs ao-onboarding-test` — the `container_name` is unchanged, so the grep still resolves. No failure mode specific to the deletion.

**3. `port: 9000` (Step 4 fixture).** See m-1. In the headless fork `port` is a deprecated, ignored legacy setting (`types.ts:1017`) with a schema default (`config.ts:252`) and no non-test reader. It is dashboard-era config in the literal sense, but it is inert, and the brief pinned steps 1–5. Severity: minor; fix optional (delete the line), and conflicting with the brief's keep-steps-1–5 rule, so keeping it is the right call.

**4. Other dashboard-related CI.** Searches `grep -rniE 'dashboard|websocket|14800|14801|9000|3000|browser|terminal|playwright|next|web'` over `.github/`, `tests/`, `scripts/` and the workflow-invoked `package.json` scripts found:

- `tests/integration/onboarding-test.sh:71` — `port: 9000` (m-1). The only real dashboard remnant.
- `scripts/claude-spawn` (iTerm2/terminal prose), `scripts/setup.sh:48,159` (`interactive terminal`, `restart your terminal`) and `:167-176` (`ao start` "what's next" text) — generic terminal/start wording, not dashboard, and those `claude-*` scripts are not invoked by any workflow.
- Removed-package names from `397b7dd1` (`packages/web/**`, `openclaw-plugin/**`, `@composio/ao-web`, `scripts/claude-dashboard`, `scripts/rebuild-node-pty.js`, `scripts/ao-update.sh`): no reference remains in `.github/`, `tests/`, `scripts/setup.sh` or the root `package.json`. The `ComposioHQ`/`linear.app/composio` strings in `scripts/claude-*` are unrelated project-name text, not the removed packages, and no workflow runs those scripts.

**5. The workflow file.** `paths` (`onboarding-test.yml:5-9`) are `packages/**`, `scripts/setup.sh`, `tests/integration/**`, and the workflow itself. The reduced job still exercises `scripts/setup.sh` (Step 2), the built CLI (Step 3) and a config (Steps 4–5), so all four trigger paths still describe real dependencies; this change touches `tests/integration/**`, so it will retrigger. The "Extract metrics" step (`:37-41`, `if: always()`) greps `Total onboarding time`, which is preserved. The "Upload test logs" step is the only weak point (m-2), and it is pre-existing. The `name`/job names are unchanged, as required.

**6. Scope and commit.** `git diff --stat 5ad7e1ce HEAD` = exactly `docker-compose.yml` (−9) and `onboarding-test.sh` (−101); no other file. Message `ci(integration): remove dashboard steps from onboarding test`, body explains WHY (headless fork, Step 6 failed, drop 6–10 + ports + shm_size). `git log -1 --format=%B` has no `Co-Authored-By`/`Signed-off-by`, no emoji, no `#<n>` issue number. `git branch -r --contains 0a81e224` prints nothing (not pushed to any remote). All conform.

## Checks D1–D6 (ran in the worktree at `0a81e224`)

- **D1** `bash -n tests/integration/onboarding-test.sh` → exit 0. `shellcheck`: **not found on this host** (`command -v shellcheck` empty), so no new-vs-`5ad7e1ce` warning comparison was possible; the baseline could not be shellchecked either. No script syntax risk.
- **D2** YAML parses with `python3` + PyYAML: `python3 -c 'import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]; print("YAML parse OK")' tests/integration/docker-compose.yml .github/workflows/onboarding-test.yml` → `YAML parse OK`.
- **D3** `grep -rniE 'dashboard|websocket|14800|14801|9000|browser' .github/ tests/` → the single line `tests/integration/onboarding-test.sh:71:port: 9000` (m-1). Nothing else; no `dashboard`, `websocket`, `14800`, `14801` or `browser` remains.
- **D4** `git diff --stat 5ad7e1ce HEAD` → `tests/integration/docker-compose.yml | 9 ----`, `tests/integration/onboarding-test.sh | 101 ------`, `2 files changed, 110 deletions(-)`. Sections 1–5 identical: `diff <(git show 5ad7e1ce:... | sed -n '1,88p') <(sed -n '1,88p' ...)` → empty (`STEPS 1-5 IDENTICAL`).
- **D5** `grep -n "Total onboarding time" tests/integration/onboarding-test.sh` → `100:echo -e "${BLUE}Total onboarding time: ${total_duration}s"`, on the success path before the `GITHUB_OUTPUT` export.
- **D6** No trailer/emoji/issue number in the commit (see item 6); `git branch -r --contains 0a81e224` prints nothing.

## What I checked and found correct

- **Removals are exactly the dashboard set.** The single hunk deletes `onboarding-test.sh` lines 87–193 (Steps 6–10) and nothing else; `docker-compose.yml` loses only the comment + `ports` + comment + `shm_size` block. Removing the step 6, 8, 9, 10 introduces no orphaned variable: `DASHBOARD_PID` and `DIRECT_TERMINAL_PORT` are gone with their only uses.
- **No hidden dependency on the removed steps.** Steps 1–5 do not reference any later variable, PID or server; the summary uses only `start_time`/`total_duration` (defined at `:15` and `:91-92`).
- **The workflow greps still match.** `container_name: ao-onboarding-test` is untouched (`docker-compose.yml:8`), so `docker logs ao-onboarding-test | grep "Total onboarding time"` still works.
- **Kill-by-name removed.** The only `pkill -f` patterns in `tests/` were inside the deleted Step 10; none remain (matches the brief's "never kill by name pattern" rule).
- **Dockerfile / run-test.sh clean.** `Dockerfile` installs only node/git/tmux/curl/jq/pnpm/gh (tmux is general headless tooling, not dashboard-only); `run-test.sh` is a plain `docker compose up/down` wrapper. No dashboard, port or browser references in either.
- **No other workflow touched.** `grep -rniE 'dashboard|websocket|14800|14801|9000|3000|browser|terminal|playwright|next|web|ao-web' .github/workflows/` → no hits.

## Files changed by this change

- `tests/integration/onboarding-test.sh` (−101: Steps 6–10)
- `tests/integration/docker-compose.yml` (−9: `ports` block + `shm_size` + comments)

## Review range

`5ad7e1ce..0a81e2246c9bb79231bfbcff929a472198b6b4c7` (one commit, `0a81e224`). Not pushed.

## Unclear or wrong in the brief

- Section 1 names only step 6, step 7 and the `DASHBOARD_PID` cleanup lines, but Steps 8 and 9 are equally dashboard/terminal/browser-only (port 14801 WebSocket, `:9000/sessions/...` page). Reading §2.3 ("remove any other line that exists only for the dashboard, the web terminal or a browser") as covering Steps 8–9 is the correct interpretation and is what the author did; the brief would be clearer if it enumerated Steps 6–10. No impact on the verdict.
- D3's pattern set includes `9000`, which Step 4's mandated fixture necessarily keeps, so D3 can never reach "prints nothing" without breaking §2.1. The brief acknowledged the tension in the author report; worth noting for the round-2 reader that the single expected hit is benign.
