# Round 3 re-check: `~/.ao/bin` PATH fix

Verdict: **NOT-LAND-SAFE**.

**0 blockers, 2 major findings, 1 minor finding.** The ordinary absolute-directory nested launch is fixed, including an attached parent and a dirty server GH_PATH. Claude still reaches the wrappers through a relative directory, and through an absolute symlink followed by `..` when startup preserves that spelling. The first case reproduces the two metadata writers on this host. The recognizer also removes an unrelated tool directory solely because its name ends in `/.ao/bin`.

HEAD: `4affc2e30134d48e916beaafa61d344c7e470ad5`. Round 3: `b21bb304..4affc2e3`; whole fix: `e674e84a..4affc2e3`. Reviewer: ao-23, Codex. No implementation changes, commits, push or PR. The author report was read after the independent nested-launch/recognizer experiments, including the attached-parent check.

Every pnpm test and scratch test used a temporary HOME and a launcher that removes **all** inherited environment names beginning `AO_`, plus TMUX and model credentials. The live SessionManager fixture introduced its own AO_STATE_ROOT under `/tmp` only after that cleanup; metadata probes introduced only their explicitly named temporary AO_DATA_DIR/AO_SESSION. Every tmux invocation, including runtime calls, used a private `-L` server with TMUX removed in the shim. The normal test server was `pathrev-r3-sol23`; the live server was `pathrev-r3-sol23-live`. No model agent ran.

## Findings

### M-1: every relative PATH entry is treated as clean, even when it is an ao wrapper directory

File: `packages/core/src/agent-workspace-hooks.ts:126`; propagated by `packages/plugins/agent-claude-code/src/index.ts:728`.

The absolute-path early return prevents both canonical-path and wrapper-header inspection of relative entries. Preserving a harmless relative entry is correct; preserving an entry that actually selects these wrappers defeats the hook-only requirement. The author's report records that relative entries remain, but the owner decision did not exempt wrapper directories reached through relative names.

Reproduction, with all paths under the temporary root:

1. Install the real current wrappers in `<temp HOME>/.ao/bin`.
2. Put a symlink `relative-link` to that directory in the temporary child workspace. Start the parent with `PATH=relative-link:<normal PATH>` and ask the actual Claude plugin for its environment.
3. Pass that environment to the actual built runtime.create on the private server, in that workspace. Launch only the command-resolution probe.

Observed:

```text
removeAoBinFromPath("relative-link:/usr/bin:/bin")
  => "relative-link:/usr/bin:/bin"
Claude environment: no PATH property; GH_PATH=""
child command -v git => relative-link/git
child command -v gh  => relative-link/gh
child GH_PATH         => empty
session GH_PATH       => GH_PATH=
```

This happened with the host's real startup behavior used for the normal probes, not just a shell with startup disabled. The same relative alias was put in the real temporary git worktree for a branch command. Through that child, the real git wrapper running a script containing `git checkout -b "feat/relative"` wrote:

```text
branch=feat/relative
```

Running the exported actual Claude hook with the equivalent successful Bash tool command then wrote:

```text
branch="feat/relative"
```

The quoted hook value is an accepted pre-existing hook defect; the two writers being active together is the isolation defect this round was meant to remove. With the ordinary absolute wrapper entry, the same script's git command used `/usr/bin/git` and left `branch=main` in the metadata until the hook could run: that case is fixed.

Required fix: distinguish harmless relative entries from entries selecting the ao wrappers in the **actual pane working directory**. The API currently receives no pane cwd, and simply preserving all relative entries cannot establish the stated invariant. Keep legitimate entries/order; add a real launch regression for a relative alias or relative `.ao/bin`. If correct cwd handling requires expanding the allowed launch-boundary files, report that scope need explicitly rather than claiming every launch is isolated.

### M-2: lexical normalization hides a wrapper directory reached through a symlink and `..`

Files: `packages/core/src/agent-workspace-hooks.ts:81`, `:89`, `:127`, `:128`.

`canonicalDir()` calls `resolve()` before physical resolution, and the header fallback uses `join(entry, "git")` / `join(entry, "gh")`. Both remove `link/..` lexically. Filesystem lookup instead follows the link before interpreting `..`, so the recognizer examines a different directory from the one an executable lookup uses.

Reproduction:

```text
<root>/home/.ao/bin/          actual current git/gh wrappers
<root>/home/.ao/subdir/       real directory
<root>/lexical/link           symlink to <root>/home/.ao/subdir
PATH entry                   <root>/lexical/link/../bin
```

Independent results:

```text
fs.realpathSync.native(entry) => <root>/home/.ao/bin
stat(entry + "/git")         => regular file, the real current wrapper
removeAoBinFromPath(entry + ":/usr/bin:/bin")
  => entry + ":/usr/bin:/bin"                 [unchanged]
```

A real runtime.create with that parent PATH returned no PATH override from the Claude plugin. In a private pane using `/bin/bash --noprofile --norc -i`, the resulting command resolution was:

```text
git => /tmp/pathrev-r3-sol23.OjbqNI/lexical/link/../bin/git
gh  => /tmp/pathrev-r3-sol23.OjbqNI/lexical/link/../bin/gh
GH_PATH=
```

This is an absolute entry, so fixing only M-1 does not fix it. The host's borrowed startup behavior happened to normalize this particular entry to `<root>/lexical/bin`, which hid the bypass in the normal-startup probe. The helper must not depend on that unrelated shell behavior; the no-profile bash pane is a supported runtime configuration and demonstrates the actual physical target.

Required fix: inspect the physical target of the original spelling before destroying its symlink/`..` semantics, and make the file-header fallback inspect that same directory. Preserve the existing missing-directory/dangling-link coverage. Add a combined symlink-plus-`..` regression; the existing `/.ao/./bin` case does not test this.

### m-1: the basename rule removes unrelated existing tool directories

File: `packages/core/src/agent-workspace-hooks.ts:127`.

A temporary directory `<root>/not-ao/.ao/bin` contained a legitimate stand-in git executable whose second line was `# real private git tool`, no ao wrappers and no ao marker. The helper still dropped the entire directory by name. A real bash launched with the Claude environment changed resolution from:

```text
before: <root>/not-ao/.ao/bin/git
after:  /usr/bin/git
```

The same applies to other legitimate tools in that directory. This is a conservative namespace choice, not a mismatch with the function's documented predicate, but it violates a broader reading of “a parent with no ao wrappers keeps its PATH.” The owner-facing paragraph does not disclose that every absolute `*/.ao/bin` is being reserved, regardless of ownership/content.

Severity: minor for the demonstrated unusual layout; it is not the reason for the unsafe verdict. Either make this namespace reservation an explicit contract and disclose its effect on unrelated tools, or refine the ownership decision while retaining protection against future installs. The ordinary non-ao `tools/git` directory was correctly preserved.

## Round-2 finding status

| R2 finding | Status | Evidence |
| --- | --- | --- |
| M-1, inherited wrappers | **Partly fixed** | All requested ordinary absolute spellings, attached parent and server GH_PATH pass. Relative aliases and physical symlink/`..` aliases still reach wrappers (new M-1/M-2). |
| m-1, source-literal tests | **Fixed for the cited seven tests** | They now compare Codex's installed content with core's exported constants. The equivalent rewrite passes the entire workspace test suite, not only the four original recursion tests. Older unlisted text checks remain, as disclosed. |
| m-2, stale Codex comment | **Fixed** | index.ts:385–388 accurately describes keeping PATH and rejecting candidate files by identity/header. Source diff is comment-only. |

## Nested launches and clean-parent comparisons

The same temporary HOME held actual 0.2.3 wrappers. Both revisions used the same parent PATH and same server. The server global environment deliberately held:

```text
GH_PATH=/server-inherited/gh
```

The driver's parent GH_PATH was a different nonempty value. At b21bb304, the session had no GH_PATH override (`show-environment` reported no session variable), and the pane inherited the server value. At the tip every Claude case, including both bypasses, had empty GH_PATH in both shell and session. A parent value alone is not automatically imported by an already-running server's default update-environment list; the author correctly clarified this.

All four agent names in the normal probes resolved to:

```text
claude    /home/taisung/.local/bin/claude
codex     /home/taisung/.nvm/versions/node/v25.7.0/bin/codex
gemini    /home/taisung/bin/gemini
opencode  /home/taisung/.opencode/bin/opencode
```

| parent entry | b21bb304 git / gh | 4affc2e3 git / gh | tip shell and session GH_PATH |
| --- | --- | --- | --- |
| temporary HOME/.ao/bin | wrapper / wrapper | /usr/bin/git / /usr/bin/gh | empty |
| trailing slash | wrapper / wrapper | /usr/bin/git / /usr/bin/gh | empty |
| doubled slash | wrapper / wrapper | /usr/bin/git / /usr/bin/gh | empty |
| absolute symlink | wrapper / wrapper | /usr/bin/git / /usr/bin/gh | empty |
| another HOME/.ao/bin | git wrapper / /usr/bin/gh (fixture held git only) | /usr/bin/git / /usr/bin/gh | empty |
| ~/.ao/bin | wrapper / wrapper | /usr/bin/git / /usr/bin/gh | empty |
| wrapper copy elsewhere | /usr/bin/git / gh wrapper (fixture held gh only) | /usr/bin/git / /usr/bin/gh | empty |
| future HOME/.ao/bin, before install | /usr/bin/git / /usr/bin/gh | /usr/bin/git / /usr/bin/gh | empty |
| dangling absolute symlink before install | /usr/bin/git / /usr/bin/gh | /usr/bin/git / /usr/bin/gh | empty |
| relative-link | relative-link/git / relative-link/gh | relative-link/git / relative-link/gh | empty |

After the future directory was installed with the actual setupPathWrapperWorkspace, the **already-running** b21 panes for both the literal future path and dangling link selected the newly created wrappers. The already-running tip panes still selected `/usr/bin/git` and `/usr/bin/gh`. Thus the future-install protection was exercised after creation, not only asserted from an absent directory's string.

An actual client attached to the private `attached-parent` session while a Node driver inside that pane called the real Claude plugin and runtime. It recorded `parentInTmux=true`. The child resolved git/gh to `/usr/bin`, selected the same four agent binaries, and had `GH_PATH=` in shell and show-environment. A separately executed tmux client remains unattached even when its parent pane has an attachment.

Clean parent: the complete Claude pane PATH at 825b0dbc and 4affc2e3 was **byte-for-byte equal**, 3137 bytes, and both plugin environments omitted PATH. The expected difference was the explicit empty GH_PATH at the tip. At b21bb304 versus 4affc2e3, the entire probe output (full PATH, six command resolutions, GH_PATH) was **identical for each of Codex, Gemini and OpenCode**. Their PATHs were 1461 bytes, with the temporary wrappers at position 18. No agent binary under `/usr/local/bin` was selected in these normal comparisons.

Baseline hooks/plugin getEnvironment/runtime source was extracted and transpiled under `/tmp`. Baseline PATH builders were the corresponding baseline implementations. Unused plugin-local imports resolved to this worktree's built helper modules; no agent method in those helpers ran. Tip probes used this worktree's actual dist modules. As in round 2, the temporary pane profile sourced the real profile only for permitted command-resolution startup behavior, then restored the fake HOME before the probe/driver ran. Outside those pane probes, startup files were read with `grep -n PATH` only. No PATH export line contained `.ao`; no host startup/config file changed.

## Every launch path and Herdr

I exercised all three through the **real built SessionManager**, current Claude getEnvironment and current runtime-tmux on the private server, with a parent PATH beginning with the normal temporary wrapper directory. A scratch config, fixture workspaces and state root were under `/tmp`. Only launch/restore commands and prompt delivery were replaced by harmless environment probes, and unrelated workspace/hook setup was supplied or disabled as fixture behavior; no model executable ran and no task prompt was typed into a shell.

| method | session | observed git / gh | observed GH_PATH |
| --- | --- | --- | --- |
| spawn | r3-1 | /usr/bin/git / /usr/bin/gh | empty |
| spawnOrchestrator (ao start's method) | r3-orchestrator | /usr/bin/git / /usr/bin/gh | empty |
| restore after destroying worker runtime | r3-1 | /usr/bin/git / /usr/bin/gh | empty |

Call sites `session-manager.ts:1132/:1138`, `:1553/:1566`, `:2557/:2574` spread the plugin environment and add AO keys; they do not repair missed directory recognition. The two bypasses therefore remain relevant to each path. This is not a claim that a live Claude model session was launched or restored.

Herdr `runtime-herdr/src/index.ts:257–274` serializes each environment entry as `--env KEY=VALUE`. Claude now supplies `--env GH_PATH=` for every launch, and a cleaned `--env PATH=<value>` when the recognizer removes an entry. Recognition misses omit that PATH override. Whether the shared Herdr server applies these values to the eventual pane remains unmeasured; severity stays the accepted minor R1 validation gap. No command changed the shared Herdr service.

## Recognizer boundaries and cost

The helper correctly preserved `/usr/local/bin/::.:relative:/usr/bin:/usr/bin`-style order/empty/relative/duplicate entries when they selected no wrappers, and an ordinary absolute tools directory with a non-ao git. It removed the requested absolute spellings and recognized a copied gh without relying on the version marker. It caught a dangling link before install and a syntactic `.ao/bin` symlink to an empty directory. M-1/M-2 and m-1 delimit the broader claims.

Instrumenting node:fs readSync in the isolated helper process recorded only reads of regular files, each requested length **256 bytes**. A FIFO named git was skipped and did not block. Source statSync-before-openSync matches this intended behavior; this is not an atomic guarantee against a file being replaced between those calls. At most two candidate file prefixes are read per inspected directory (git, then gh if needed), rather than 256 bytes for the entire PATH.

300 invocations per case, actual inherited PATH: **2.72 ms** for 86 entries; **2.77 ms** for 87 entries including the wrapper directory; **2.80 ms** including the dangling-link spelling. These are local measurements, not a fixed time bound on arbitrary filesystems. Work occurs once per Claude getEnvironment call, not per git call.

The installed GH_WRAPPER, GIT_WRAPPER and AO_METADATA_HELPER strings are **byte-for-byte unchanged from b21bb304**. WRAPPER_VERSION staying 0.2.3 is appropriate. Their new public exports from core are additive, expose the same authoritative strings the installer already owns, and allow plugin tests to check that installed output comes from core. Importing them does not install anything. This is a reasonable scoped test contract; it does not itself prove shell behavior, which core's real execution tests cover.

## Gates, counterfactuals and equivalent rewrite

Normal gates ran in this worktree. Every test invocation passed through the clean launcher described above; no inherited AO variable was retained. `pnpm install` and `pnpm build` both exited 0. Requested four-package typecheck filters and full `pnpm typecheck` exited 0 (13 `typecheck: Done` lines); build had 12 `build: Done` lines.

```text
core          Test Files 31 passed (31)    Tests 691 passed (691)
runtime-tmux  Test Files  1 passed (1)     Tests  30 passed (30)
claude-code   Test Files  3 passed (3)     Tests 164 passed (164)
codex         Test Files  3 passed (3)     Tests 210 passed (210)
```

`pnpm lint`: exit 0, `6 problems (0 errors, 6 warnings)`, all outside changed files. Full `pnpm test`: exit 0, **1940 passed, 29 skipped (1969)**. Per package: core 691; Gemini 58; Claude 164; Codex 210; desktop 26; Herdr 36; SCM 140 + 5 skipped; tracker 42; worktree 46; tmux 30; OpenCode 159; integration 95 + 24 skipped; CLI 243. Integration:

```text
Test Files 10 passed | 3 skipped (13)
Tests      95 passed | 24 skipped (119)
```

The 24 integration skips are the credential-dependent prompt-delivery/Claude/Codex/OpenCode live cases (4/10/5/5); the temporary HOME does not hold credentials. No known-red exception was used.

Non-vacuity: archive b21bb304 into the temporary scratch copy; copy the tip's changed tests; use dependency links plus a scratch Vitest alias selecting the scratch core source. Add **only GH_WRAPPER/GIT_WRAPPER exports** to the old barrel so the launch fixtures can use actual old scripts; this changes no implementation behavior.

| package | result on old implementation |
| --- | --- |
| core | `14 failed | 677 passed (691)`: all 14 new removeAoBinFromPath tests fail because the function does not exist. This proves an API addition, not discriminating coverage of the two bypasses. |
| claude-code | `9 failed | 155 passed (164)`: empty-GH_PATH property plus all eight real child-launch cases. The failures observe retained parent PATH, not just an absent property. |
| runtime-tmux | `30 passed (30)`: production runtime source is unchanged; the new test checks a pre-existing transport capability needed by the plugin fix. |
| codex | `210 passed (210)` with export-only compatibility: it correctly installs its own core's constants. Without the new exports the identity tests lack their expected API; no behavior failure should be inferred from that alone. |

Equivalent rewrite: in a separate current-source scratch copy, replace only the shell conditional `[[ "$candidate" -ef "$0" ]] && return 1` with `if [[ "$candidate" -ef "$0" ]]; then return 1; fi`. All packages' test scripts used their normal configuration plus the scratch-core alias, so the new wrapper constants and actual installer seen by plugin tests were the mutated ones. The **entire workspace suite passed: 1940 passed, 29 skipped (1969)**, including core 691, Claude 164, Codex 210 and integration 95 + 24 skipped. This confirms R2 m-1 is fixed for that behavior-preserving rewrite. Intermediate scratch harness/config errors were corrected before this final run and are not product failures.

## Scope, history and R1 status

All eight changed files are allowed by the round-3 brief: core hooks, its main test and exports-only barrel; Claude source/test; runtime-tmux test; Codex test and comment-only source change. Runtime-tmux production source, session-manager, OpenCode, Gemini, workflows and configs are unchanged this round. The five subjects are:

```text
cee3b013 fix(core): add removeAoBinFromPath for panes that must not run the wrappers
f9e85891 fix(agent-claude-code): remove inherited ao wrapper directories from the pane PATH
7f1a3b90 test(agent-codex): check that Codex installs the core wrappers, not their source text
5d0c065b fix(agent-codex): describe how the wrappers avoid recursion as they do now
4affc2e3 test(agent-claude-code): use type-only imports in the launch test
```

Bodies explain why; no Co-Authored-By, emoji or issue number. `git branch -r --contains 4affc2e3` prints nothing. The current worktree's tracked diff remains empty.

I independently linted f9e85891's launch-test file in the scratch copy: **2 consistent-type-imports errors** at lines 57/327 and **1 no-template-curly-in-string warning** at 340, exit 1. The final file passes the normal full lint gate. Severity: historical minor gate hygiene, **fixed at the reviewed tip**, not an additional outstanding finding. Do not land/cherry-pick f9 alone; the explicit no-amend/no-rebase instruction explains the follow-up commit.

R1 statuses below carry forward the R2 independent experiments, checked against unchanged script/runtime implementations and the current passing real wrapper tests. This re-check did not repeat every R1 experiment.

| R1 finding | Current status/evidence |
| --- | --- |
| B-1, stale /usr/local agents | Fixed for ordinary host launches; all four normal command paths unchanged. m-1 above limits the unrelated-directory case. |
| M-1, typed PATH instead of client environment | Fixed; runtime implementation unchanged and current client/PATH tests pass. |
| M-2, wrong git branch writes | Fixed for specified operations; unchanged script, current real git tests pass. |
| M-3, wrapper marks session merged | Fixed in wrappers; unchanged script, real gh tests pass. Claude hook remains accepted unchanged. |
| M-4, Claude wrapper/hook ownership | Partly fixed; ordinary nested launches pass, new M-1/M-2 still violate hook-only ownership. |
| m-1, 300 ms export delay | Fixed; no new typed-export path. Existing long-command delay remains separate. |
| m-2, export wall of text | Fixed; no typed export in normal or alias probes. |
| m-3, 4095-byte typed line | Fixed; PATH remains transported in client environment. R2 live long-PATH evidence still applies. |
| m-4, per-git overhead | Accepted retained cost; script unchanged. New Claude sanitization adds measured launch-time work only. |
| m-5, gh stderr mixing | Fixed; unchanged wrapper and real stream tests pass. |
| m-6, missed -q/-C branch creation | Fixed; unchanged wrapper and real branch tests pass. |
| m-7, recursive wrapper resolution | Fixed for requested spellings/copies; git tests plus three additional real gh PATH tests pass. |
| m-8, mixed-build installation | Accepted retained limit; shared installer and script version unchanged. |
| m-9, non-discriminating/missing tests | Fixed for cited gaps: no-op/skip tests remain, versions derived, cited text checks replaced and equivalent rewrite passes. |
| m-10, queued mocks | Fixed; resetAllMocks remains and runtime suite passes 30/30. |
| m-11, inaccurate mechanism comments | Codex stale comment fixed; absolute Claude exclusion statement remains too broad because of new M-1/M-2. |
| m-12, commit format | Correct for new commits; original round-1 feat subject remains unchanged as instructed. |
| m-13, Herdr | Accepted minor validation gap; shared service not exercised or changed. |

## Owner text audit and corrected paragraph

R8's first paragraph describes unchanged Codex/Gemini/OpenCode wrappers and is consistent with R2 evidence and this round's equal script strings, unchanged panes and passing real execution tests. Its roughly 5 ms overhead is explicitly the earlier measurement, not a new universal bound. The PR/main/merged/stderr statements remain correct under their stated wrapper conditions; stale branch metadata can still be refreshed by a successful file checkout, as R2 noted.

R8's second paragraph is **not fully true**: empty GH_PATH is verified for all cases, but “no ao wrappers”, “every ao wrapper directory”, and “only writer” fail for M-1/M-2. “Clean parent ... same PATH” is true for the measured normal parent but has the name-only false-positive qualification in m-1. Hook limitations and the startup re-addition caveat are accurate. The first/last paragraphs' install-version, old in-flight installer, unchanged existing pane PATH and startup-reset limits carry forward unchanged. There is no current lifecycle-worker restore/install path to add to that list.

Corrected owner text:

> New and restored Codex, Gemini and OpenCode panes keep round 2's behavior: on this host their agent commands select the same installations, and git/gh use shared ao scripts. Simple git calls previously measured about 5 ms extra; branch tracking and PR creation do more work. Successful PR creation records a recognized GitHub URL and pr_open. Checkout or switch in the session's own worktree records its attached branch; failed, detached and other-worktree calls leave the record alone. Returning to main records main, so PR fallback then searches by main when no PR URL is stored. The wrappers do not mark sessions merged, and gh errors stay on stderr. Claude now clears GH_PATH and removes the tested ordinary absolute wrapper directories for spawn, start and restore, including an attached parent and dirty server. It still misses relative wrapper paths and physical aliases containing a symlink followed by `..`; fix those before claiming its native hook is the only writer. The name rule also reserves every absolute `*/.ao/bin`, potentially removing unrelated tools. Normal clean-parent PATHs match the baseline. The native hook's quoted-branch/direct-merge limits remain, and startup files can re-add wrappers. The first relevant setup installs shared version 0.2.3. Old in-progress spawn, batch, start or restore calls, old-build launch paths and resident SessionManager users can install 0.2.1 again; quiesce or replace them before rollout. A rebuild does not change existing pane PATHs, and startup files that reset PATH can still drop wrappers from the other agents.

## Integrity, full PATH evidence and cleanup

Full normal nested-child probe at b21bb304:

```text
PATH=/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/tmp/pathrev-r3-sol23.OjbqNI/home/.ao/bin:/tmp/pathrev-r3-sol23.OjbqNI/live-shim:/tmp/pathrev-r3-sol23.OjbqNI/shim:/home/taisung/.nvm/versions/node/v25.7.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path:/home/taisung/.codex/tmp/arg0/codex-arg06wWRUx:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:/home/taisung/anaconda3/bin:/home/taisung/anaconda3/condabin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin
/home/taisung/.local/bin/claude
/home/taisung/.nvm/versions/node/v25.7.0/bin/codex
/home/taisung/bin/gemini
/home/taisung/.opencode/bin/opencode
/tmp/pathrev-r3-sol23.OjbqNI/home/.ao/bin/git
/tmp/pathrev-r3-sol23.OjbqNI/home/.ao/bin/gh
GH_PATH=/server-inherited/gh
```

Full normal nested-child probe at 4affc2e3:

```text
PATH=/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/tmp/pathrev-r3-sol23.OjbqNI/live-shim:/tmp/pathrev-r3-sol23.OjbqNI/shim:/home/taisung/.nvm/versions/node/v25.7.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path:/home/taisung/.codex/tmp/arg0/codex-arg06wWRUx:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/home/taisung/.local/bin:/home/taisung/.local/bin:/home/taisung/bin:/home/taisung/.local/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.opencode/bin:/home/taisung/anaconda3/bin:/home/taisung/anaconda3/condabin:.:/home/taisung/Scripts/BiblibTools:/home/taisung/Scripts/FileUtility:/home/taisung/Scripts/freeEnergy:/home/taisung/Scripts/RunAmberJob:/home/taisung/Scripts/awk:/usr/lib64/openmpi/bin:/home/taisung/amber/amber_lbsr_test/bin:/usr/local/cuda/bin:/home/taisung/devel/git/Management/Git:/home/taisung/devel/git/Management/LaTeX/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin
/home/taisung/.local/bin/claude
/home/taisung/.nvm/versions/node/v25.7.0/bin/codex
/home/taisung/bin/gemini
/home/taisung/.opencode/bin/opencode
/usr/bin/git
/usr/bin/gh
GH_PATH=
```

Before install/build/tests:

```text
total 24
drwxr-xr-x 2 taisung users 4096 2026-09-16 13:01:16.796056907 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-09-16 13:01:16.796056907 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2350 2026-09-16 13:01:16.794056970 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 1758 2026-09-16 13:01:16.794056970 -0400 gh
-rwxr-xr-x 1 taisung users 1333 2026-09-16 13:01:16.795056939 -0400 git
89e9b7a95433d03c9e6a70996ea47c58  /home/taisung/.ao/bin/ao-metadata-helper.sh
dafbcf0fd58eb25b17fa60cefd0e5aa5  /home/taisung/.ao/bin/gh
ba65621595472c0d72f6ae274987f4c9  /home/taisung/.ao/bin/git
96a5d0f2a178420f4134741cf92b684c  /home/taisung/.ao/bin/.ao-version
```

After tests/live probes and server shutdown:

```text
total 24
drwxr-xr-x 2 taisung users 4096 2026-09-16 13:01:16.796056907 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-09-16 13:01:16.796056907 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2350 2026-09-16 13:01:16.794056970 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 1758 2026-09-16 13:01:16.794056970 -0400 gh
-rwxr-xr-x 1 taisung users 1333 2026-09-16 13:01:16.795056939 -0400 git
89e9b7a95433d03c9e6a70996ea47c58  /home/taisung/.ao/bin/ao-metadata-helper.sh
dafbcf0fd58eb25b17fa60cefd0e5aa5  /home/taisung/.ao/bin/gh
ba65621595472c0d72f6ae274987f4c9  /home/taisung/.ao/bin/git
96a5d0f2a178420f4134741cf92b684c  /home/taisung/.ao/bin/.ao-version
```

The two full host listings and all four hashes compare byte-for-byte equal (`cmp` exit 0). Private live server PID 3636873 and all captured pane PIDs were no longer live after explicit private-server shutdown. The attached client exited. The test server reported no server running. The scratch copies, test HOME/state and private sockets are removed at completion. No real global config, wrapper, startup file, agent service or primary-checkout build changed. Only this new review and the required replacement `.agent_report.md` are produced; the round-2 review/task file were pre-existing inputs.
