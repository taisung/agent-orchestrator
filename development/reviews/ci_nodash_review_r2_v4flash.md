# Review — CI cleanup, round 2: re-check (`ebc8e25b..353ef189`)

**Reviewer**: DeepSeek V4.1 Flash (blind round-2 re-check; I authored the round-1 V4.1 Flash review).
**Range reviewed**: `git diff ebc8e25b 353ef189`, two commits — `b6d85710` (`test(integration): restore sync config-load step and drop dead port key`) and `353ef189` (`chore(lint): drop dashboard web ignores from eslint config`).
**Files**: `tests/integration/onboarding-test.sh` (+4/−1), `eslint.config.js` (−13). Nothing else.
**Worktree HEAD**: `353ef1899a484b1a27b7e95e467f49d93322d77d` (`ebc8e25b` = round-1 `0a81e224` on `main`).
**Date**: 2026-10-15.
**Method**: read both round-1 reviews first, then read the `--no-orchestrator` path of `runStartup` independently in `packages/cli/src/commands/start.ts`, then read the author report only after forming my own reading; ran read-only checks D1–D6 (including `pnpm install` + `pnpm lint` before/after under `HOME=/tmp/opencode/ao22-home`). No tracked file edited, nothing committed or pushed.

## Verdict

**LAND-SAFE**

Round 2 fixes all three round-1 findings correctly. The restored synchronous step 6 is safe on the `--no-orchestrator` path in the CI container and guards the exact regression round 1 left open; `port: 9000` is gone; the eslint web ignores are gone with equal lint counts. Two new minor dashboard/web remnants remain, both outside the brief's two allowed files and both with no CI effect.

## Status of the round-1 findings that round 2 acts on

### M-1 (Sonnet, major) — restore the config-load step — **FIXED**

`b6d85710` adds, exactly where the removed step 6 was (`onboarding-test.sh:89-91`):

```bash
start_step "Step 6: Load configuration with ao"
ao start --no-orchestrator || fail_step "Step 6: ao start --no-orchestrator failed"
end_step "Step 6: Configuration loaded by ao"
```

This matches the shape the Sonnet review prescribed and adds no `&`, `curl`, wait loop or `kill`. It runs synchronously, so a nonzero exit fails the job (`|| fail_step` neutralises `set -e` for the guarded command and `fail_step` exits 1).

**Is the path safe in the CI container?** I read `runStartup` (`start.ts:863-985`) and the command action (`:1010-1106`) myself. For `ao start --no-orchestrator` with no argument, cwd `/tmp/ao-test-project` (a single-project config), no `--interactive`, non-TTY:

| Step of the path | Line | External action |
|---|---|---|
| `loadConfig()` (no arg → `findConfigFile` from cwd) | `:1068` | Pure file read + Zod validation; no command, no network |
| `resolveProject(config, undefined)` — one project | `:1078`, `:89-95` | Returns immediately; no prompt (prompt only for multiple projects) |
| `opts.interactive` agent prompt | `:1082` | Skipped (`--interactive` unset) |
| `runtime = config.defaults?.runtime ?? "tmux"` → `ensureTmux()` | `:873`, `:833-857` | Exactly one external command: `execSilent("tmux", ["-V"])`. tmux is installed in the image (`Dockerfile:7`), so it returns and never reaches `askYesNo`. If it were missing, `askYesNo(..., nonInteractiveDefault=false)` → `canPromptForInstall()` is false in CI (`caller-context.ts:14`, non-TTY → `"agent"`), so no install is attempted and it exits 1 — a correct "tmux required" signal, not triggered here |
| `shouldStartLifecycle = opts?.orchestrator !== false` → `false` | `:877` | `ensureLifecycleWorker` (`:891`) skipped — no worker process |
| orchestrator block `if (opts?.orchestrator !== false)` | `:909-910` | Skipped — no `getSessionManager`, no `sm.list`, no `sm.spawnOrchestrator`, no tmux session, no agent launch |
| summary + return | `:967`, `:984` | `✓ Startup complete`, `Config: …`, then returns; the only `process.exit(1)` on this path is the `catch` at `:1105` |

`gh` is reached only via `handleUrlStart`/clone (`:492`, `:495`) and the gh-install prompt in the path-add flow (`:678`); `npm install -g` only via `AGENT_INSTALL_OPTIONS`/`promptInstallAgentRuntime` (`:405-476`), gated by `canPromptForInstall()` (false in CI). `git clone` only in the URL path (`:508`, `:515`). None is on this path. **Conclusion: no server, no long-running process, no install, no `gh`, no `git`, no network; on a good config it exits 0.** The old CI log confirms it: run `38771289585` printed `Starting orchestrator for test-project`, `✓ Startup complete`, `Config: /tmp/ao-test-project/agent-orchestrator.yaml` before the (dashboard) loop misread the clean exit as a death.

**Does the step-4 config naming no agent matter?** No. `onboarding-test.sh:68-77` names no agent, no `defaults`, no `orchestrator`, no `worker` keys (only `dataDir`, `worktreeDir`, `projects.test-project.{repo,path,defaultBranch}`). `DefaultPluginsSchema` supplies `agent: "claude-code"` and `runtime: "tmux"` (`config.ts:220-227`), but on `--no-orchestrator` no session is constructed and no agent is resolved, so the agent default is never used. The only indirect effect of the missing `defaults` is that `runtime` defaults to `tmux`, which is what triggers the (harmless) `ensureTmux()` check. My independent list matches the author's D5 list, line for line.

### m-1 (V4.1 Flash + Sonnet, minor) — delete `port: 9000` — **FIXED**

`b6d85710` removes the single `port: 9000` line from the step-4 heredoc, and `git show b6d85710` shows nothing else in step 4 changes. Re-confirmed `port`/`terminalPort`/`directTerminalPort` are dead: no non-test source in `packages/` reads any of them (`grep` finds only the schema/default lines in `config.ts:252` and the `@deprecated` declarations in `types.ts:1016-1023`). D2 now prints nothing. (Cosmetic: the deletion leaves one blank line at `onboarding-test.sh:71`; valid YAML, no effect — see n-2.)

### m-2 (Sonnet, minor) — remove dashboard entries from the lint config — **FIXED**

`353ef189` removes `**/dist-server/**`, `**/.next/**`, the three `packages/web/*` ignores, and the "Relaxed rules for Next.js pages/components" block. I verified each matched nothing:
- `ls packages` → `ao cli core integration-tests plugins`; no `packages/web`.
- No source produces `dist-server`; every `tsconfig*.json` sets `outDir: "dist"`. Repo-wide `grep dist-server` (excluding `node_modules`, `.git`, `dist`) → nothing.
- No `package.json` declares a `next` dependency; the only `.next`/`next` hit in `packages/` is `packages/cli/src/lib/project-detection.ts:50`, a heuristic that inspects the *user's* project `package.json` for a `next` dependency (and `packages/cli/templates/rules/nextjs.md`, an agent-rule template). Neither is a build producer.
- `pnpm lint` before (config from `ebc8e25b`, run via `--config`, sited outside the tree) → `✖ 6 problems (0 errors, 6 warnings)`; after (`353ef189`) → `✖ 6 problems (0 errors, 6 warnings)`, identical file list (`spawn.ts:339`, `activity-log.ts:91`, `plugin-registry.ts:232`, `session-manager.ts:1269`+`1276`, `agent-opencode/index.ts:433`). Equal, not higher.

## New findings

### m-1 (new, minor) — `.eslintignore` still lists the same dead web/Next.js paths

`.eslintignore:10` (`packages/*/dist-server/`), `:23-25` (comment `# Web/Next.js specific (build artifacts)`, `packages/web/.next/`, `packages/web/next-env.d.ts`). These are the same dashboard/web remnants the round-2 commit just removed from `eslint.config.js`. `packages/web` does not exist and nothing produces `dist-server` or `.next` (evidence above), so every entry matches nothing.

Evidence it has no CI effect: `pnpm lint` prints

```
ESLintIgnoreWarning: The ".eslintignore" file is no longer supported.
Switch to using the "ignores" property in "eslint.config.js"
```

so ESLint 10 (`eslint 10.2.0`, flat config) never reads it, and does not fail on it. **Severity: minor.** It is technically outside the brief's two allowed files (and outside item 4's enumerated surfaces), so this is a follow-up, not a land blocker. Fix (optional): delete lines 10 and 23-25, or delete the now-inert file. If the owner wants the lint surface fully clean, do it in the same `chore(lint):` follow-up.

### n-1 (new, note) — `.prettierignore:3` (`.next/`) is the same class of remnant

`.prettierignore:3` ignores `.next/`, a Next.js output that no longer exists. Prettier is not run by any workflow (`.github/workflows/*` run `pnpm lint`, `build`, `typecheck`, `test`, `test:integration`, `changeset publish` — no `format`/`format:check`), so this is not CI and not actionable here. Listing it for completeness only.

### n-2 (new, note) — blank line left in the step-4 heredoc

`onboarding-test.sh:71` is now an empty line where `port: 9000` was. Valid YAML, no behavioural difference, and the brief said "change nothing else in step 4", so leaving it is defensible. Cosmetic only.

## Review items (brief §2)

**1. The new step 6.** Covered in the M-1 status above: synchronous, guarded by `|| fail_step`, cannot block, prompt, start a long-running process / server / install / `gh` call, or exit nonzero on a good config in the CI container. The step-4 config names no agent, which does not matter on this path. My line-by-line audit matches the author's D5 (below).

**2. `port: 9000`.** Gone; nothing else in step 4 changed (verified via `git show b6d85710` and a byte diff of the heredoc region). See m-1 status.

**3. `eslint.config.js`.** Every removed entry matched nothing; no other dashboard-only entry is left in the file (current ignores: `dist`, `node_modules`, `coverage`, `test-clipboard*.mjs`, `test-clipboard*.sh`); `pnpm lint` counts equal before/after (0 errors, 6 warnings). See m-2 status.

**4. Any other dashboard-related CI.** Searched `.github/`, `tests/`, `eslint.config.js`, `package.json`, `pnpm-workspace.yaml`, `.changeset/`, and the CI-run `scripts/setup.sh`:
- No `dashboard`, `websocket`, `14800`, `14801`, `next.config`, `postcss`, `playwright`, `packages/web`, `dist-server` or `.next` hit in any of them (single grep exit 1).
- `scripts/setup.sh` has only the generic phrase `What's next:` (line 167); `ao start` appears in its closing "What's next" text, which is correct for the headless fork.
- Remaining remnants are `.eslintignore` (m-1 new) and `.prettierignore` (n-1 new), neither of which is read by CI. `.gitignore` is declared out of scope by the brief and was not inspected.
- Not CI, so out of scope: the hidden `--no-dashboard` option (`start.ts:997`), the deprecated `port`/`terminalPort`/`directTerminalPort` keys (`config.ts:252-254`, `types.ts:1016-1023`), `DASHBOARD_FIXES_SUMMARY.md` and root `test-ao-config.yaml:3`.

**5. Scope and commits.** `git diff --stat ebc8e25b HEAD` = `eslint.config.js | 13 -------------` and `tests/integration/onboarding-test.sh | 5 ++++-` (`2 files changed, 4 insertions(+), 14 deletions(-)`), only the two allowed files. Subjects `test(integration): restore sync config-load step and drop dead port key` and `chore(lint): drop dashboard web ignores from eslint config`, each with a WHY body. `git log -1 --format=%B` for both has no `Co-Authored-By`/`Signed-off-by`, no emoji, no `#[0-9]+`. `git branch -r --contains 353ef189` prints nothing.

## Checks D1–D6 (evidence)

- **D1** `bash -n tests/integration/onboarding-test.sh` → exit 0.
- **D2** `grep -rniE 'dashboard|websocket|14800|14801|9000|browser' .github/ tests/` → no matches (exit 1). The round-1 hit at `onboarding-test.sh:71` is gone.
- **D3** `grep -nE 'dist-server|\.next|packages/web|next\.config|postcss|Next\.js' eslint.config.js` → no matches (exit 1).
- **D4** `pnpm lint` (`HOME=/tmp/opencode/ao22-home`; `pnpm install --frozen-lockfile --offline` first failed with `ERR_PNPM_NO_OFFLINE_TARBALL` on `@clack/prompts-0.9.1.tgz`, so I ran the online `pnpm install --frozen-lockfile` worktree-locally, same deviation as the author). Before (config from `ebc8e25b`): `✖ 6 problems (0 errors, 6 warnings)`. After (`353ef189`): `✖ 6 problems (0 errors, 6 warnings)`. Equal.
- **D5** `--no-orchestrator` audit: `loadConfig()` `start.ts:1068` (pure read); `resolveProject` single project `:1078`/`:89-95`; interactive prompt skipped `:1082`; `ensureTmux()` `:873` → one command `tmux -V` (`shell.ts:23-31`), tmux present (`Dockerfile:7`); `shouldStartLifecycle=false` `:877`; orchestrator block skipped `:909-910`; summary `:967`; only exit(1) is catch `:1105`. `gh`/`npm install -g`/`git clone` only on URL/auto-create/prompt paths (`:405-476`, `:492-516`, `:678`). Step-4 config agent: none named. Matches the author's D5.
- **D6** see item 5: two files, two conventional commits with WHY, no trailer/emoji/issue, `git branch -r --contains 353ef189` empty.

Risks named: no Docker on this host, so the step-6 pass rests on reading the code plus the round-1 CI log, not a live container run; the next `main` push is the live check. `execSilent`/`exec` (`shell.ts:11-31`) set no timeout, so `tmux -V` could in principle block if tmux hung — negligible for a read-only version check, and pre-existing. The Step-2 `./scripts/setup.sh` path still uses the network (registry, apt, Docker Hub), unchanged by round 2.

## Unclear or wrong in the brief(s)

- The round-2 author brief §3.1 says "The test configuration of step 4 names its agent: say which." The step-4 config names no agent (no `agent`, `defaults`, `orchestrator` or `worker` keys). The reviewer brief item 1 states this correctly ("names no agent"). Not blocking: the agent is unused on the `--no-orchestrator` path, so the author's decision not to stop as `blocked` was right, and the author report records "names NO agent".
- The brief's item 4 surface list (`.github/`, `tests/`, `eslint.config.js`, CI-run scripts) omits `.eslintignore`, which holds the same dead web paths the round-2 lint commit cleaned from `eslint.config.js`. I filed it as new m-1 despite its no-CI-effect status, so the owner can decide whether a lint-adjacent dead file is in scope.

## Recommendation

Land `b6d85710` and `353ef189`. They close the one real coverage gap round 1 opened and clear the two dead-config items, with equal lint counts. Then, optionally, a `chore(lint):` follow-up to strip the dead web/Next.js paths from `.eslintignore` (new m-1); `.prettierignore` (n-1) and the step-4 blank line (n-2) need no action.

## Review range

`ebc8e25b..353ef1899a484b1a27b7e95e467f49d93322d77d`. Not pushed.
