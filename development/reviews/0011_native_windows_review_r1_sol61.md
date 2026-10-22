# Native Windows plan review r1 — gpt-6.1-sol

Date: 2026-10-21. Artifact type: feasibility and porting plan, assessed as a proposed experiment/work sequence rather than a finished implementation design.

## Scope, snapshot, and verdict

Reviewed `development/0011_native_windows_feasibility_and_porting_plan.md` with SHA-256 `3ea1e1f974695b9863e9733a8fd292cb4b68164b4f1d8f3e44080a8ee28584e1`. Actual HEAD was `ad92d24ac83569fa7516f4d719db83d853a5fbb8`; the plan records source baseline `8070ff0aa4b4afe1669504877346cf827b883973`. The committed difference contains only HANDOVER.md, TODO_TRACKING.md, and the model-router CSV. It does not change source conclusions. The working tree also contains unrelated TODO edits and a deleted test config; neither was changed for this review.

I read AGENTS.md, CLAUDE.md, the res-audit skill, and writing-hygiene and its blocklist. Inspection covered the Herdr adapter/helper, locks and metadata, path/config utilities, lifecycle service, workspace plugin, and selected agent launch/activity paths. This was read-only Linux inspection. No Windows host, runtime launch, agent invocation, installation, rebuild, or full suite was exercised. Tests below are proposed and **unrun**.

**Verdict: ready for W0 native measurement. Amend the inventory and qualification gates before treating this as an implementation acceptance plan. No critical issues were found.** The conclusion that native Windows needs a port rather than a runtime configuration change survives this review. The existing Herdr false-absence, reused-ID destruction, and Linux-only locking/process checks are acknowledged work in plan lines 87–90 and 113–136; they are not new findings here.

Primary-source checks on this date support the plan's upstream caveats: [Herdr Windows support](https://herdr.dev/docs/windows-beta/) describes ConPTY, process-tree detection, persistent sessions, and the direct terminal-attach limitation. This is an upstream statement, not local Windows evidence. [Node child-process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows) supports the `.cmd`/`.bat` boundary described in the plan. These current pages do not establish behavior of the future pinned profile.

## Findings

### 1. Major — Worktree enumeration has a concrete path-format boundary missing from the inventory

Plan references: lines 91, 169–172, 181, and 191–199. The workspace row identifies hooks and symlinks but does not name inventory parsing. “Path behavior” and a general workflow pass leave this failure easy to miss.

Source: `packages/plugins/workspace-worktree/src/index.ts:209` constructs `projectWorktreeDir` with native `join()`. Lines 234–243 parse Git porcelain as raw text; line 250 admits a worktree only if the raw Git path equals that native directory or starts with `projectWorktreeDir + "/"`. There is no separator or representation normalization at that comparison. A forward-slash record such as `C:/Users/A/.agent-orchestrator/worktrees/demo/s1` fails against native `C:\Users\A\.agent-orchestrator\worktrees\demo`, even though both denote the intended descendant. This is a source-level counterexample; I did not measure the selected Git for Windows output. The parser also lacks decoding for quoted porcelain paths. [Git's worktree documentation](https://git-scm.com/docs/git-worktree#_porcelain_format) specifies quoting unusual path characters unless `-z` is used.

Impact: native creation can succeed while `Workspace.list()` silently returns no matching worktrees. A smoke test using only recorded session metadata can pass without testing this API. Restoring and managing inventory requires a defined path comparison policy, not only executable portability.

**Falsification/acceptance test — unrun:** capture `git worktree list --porcelain` and `--porcelain -z` from the pinned Git for Windows for two disposable AO worktrees under a space/non-ASCII user path. Exercise the plugin's `list(projectId)` and compare returned paths/session IDs with the known worktrees. Add a deterministic parser test using the forward-slash record and native backslash base above. Expected: both intended worktrees appear exactly once; a sibling named `demo-other` is excluded; a quoted path is either decoded correctly or explicitly unsupported. Record drive-case behavior separately rather than assuming blanket lowercasing is safe for every supported filesystem.

Minimal amendment: explicitly add Git output parsing and canonical containment to W1/W3 and the inventory; require direct `Workspace.list()` coverage, including the selected non-ASCII Git quoting policy.

### 2. Major — A passing operator workflow does not yet require correct agent introspection

Plan references: lines 162–167 focus on process identity; W1 at line 179 requires launch/model/permissions/hooks, W3 at line 181 says status/restore pass, and lines 197–199 mention prompts/exit/restore. None defines what status must report while an agent is actively working, or proves restore resumes the same conversation.

Source: `packages/plugins/agent-claude-code/src/index.ts:303` converts a workspace path into an assumed Claude project-directory name. Lines 880–887 then search that directory and return `idle` if no session file is found. Consequently, an incorrect native path convention can produce a plausible idle status indefinitely while the agent is busy. The Windows-aware replacement at lines 304–307 is not evidence that the installed agent uses that exact convention. Session information and restore also use that mapping at lines 944–979. Codex has another persisted-data boundary at `packages/plugins/agent-codex/src/index.ts:59` (the fixed home-relative session root); Gemini guards restore through `packages/plugins/agent-gemini/src/index.ts:67` by checking whether any directory exists, rather than proving the intended conversation exists. These need per-agent measurement, even where no Windows failure has yet been demonstrated.

Impact: a pane can launch, hooks can record a PR, and `ao status` can print a row while activity detection or conversation recovery is wrong. That would leave lifecycle automation unqualified despite a nominal W3 pass. This is an acceptance gap, not a claim that every current native-agent data format is incompatible.

**Falsification/acceptance test — unrun:** for the first selected agent, capture its actual native session-data path and session identifier, issue a task long enough to observe activity, then a deliberate permission prompt and a completed turn. Compare AO's observations with the agent and runtime evidence. Test active, ready, idle, waiting_input/blocked where supported, and exited; distinguish unavailable evidence from a negative process result. Close/reopen the operator terminal, restore the AO session, and ask for a unique fact from the original conversation. Expected: states follow evidence with documented time bounds; the original conversation ID/fact survives; unavailable logs do not silently qualify as correct idle behavior. Repeat independently for every agent before listing it as supported.

Minimal amendment: add an agent-native data/session binding inventory and an explicit per-agent activity and same-conversation restore gate to W3/W4. Allow a documented unsupported signal only if the resulting lifecycle limitation is also explicit.

### 3. Minor — Quoting is acknowledged, but the proposed tests do not challenge shell metacharacters

Plan references: lines 98–101 and 142–147 explicitly call for controlled shell boundaries; lines 191–192 test spaces/non-ASCII. Those cases do not detect percent expansion, delayed expansion, or quote/backslash damage introduced by a `.cmd` bridge. Source `packages/core/src/utils.ts:14` is POSIX quoting, and `packages/plugins/runtime-herdr/src/index.ts:289` currently sends a Bash script through another CLI. Conversion crosses multiple interpreters.

Add an argv-echo fixture for each supported executable/shim format. Round-trip empty arguments, embedded quotes, trailing backslashes, multiline prompts, literal `%NAME%`, `!NAME!`, `&`, `|`, `$()`, and backticks through the exact AO → Herdr → launcher route. Compare bytes/argument boundaries and verify no extra command runs. This is a proposed **unrun** regression test, not an observed injection defect in the proposed implementation.

## Hidden assumptions and sequencing limits

- A generic Windows-aware path helper does not establish agent-specific on-disk naming, Git output representation, or lock identity. Measure each boundary with the pinned tools.
- Herdr privilege context must be part of the profile. Its current official Windows documentation states elevated servers normally require administrator clients; an access refusal must remain unknown/error, not absent. Add a mixed-elevation refusal probe to the already planned Herdr failure matrix. No new broad privilege-sharing requirement is implied.
- W1 runs before the safety work in W2. Keep it explicitly disposable and supervised, with automated cleanup/reactions disabled until the ownership/stop gates pass. The plan calls W1 a development smoke test; that restriction needs to govern the test procedure, especially on an existing Herdr server.
- A Linux mocked suite and Windows CI can both pass without a real agent/Herdr end-to-end run. W4 should identify which checks are mocked and attach the actual native qualification transcript for the supported profile.

## Prioritized minimum amendments

1. Add worktree inventory parsing/containment to the blocker inventory and require its direct native test.
2. Require measured native agent data locations, activity transitions, and same-conversation restore before W3/W4 qualification.
3. Add argv byte/argument round-trips for the chosen `.exe`/`.cmd`/Node route; retain the plan's ban on blanket `shell: true`.
4. State disposable W1 execution limits and record native versus mocked evidence separately in the release gate.

These changes do not require choosing the final Windows lock primitive or rewriting the whole plan before W0. They make later passes mean that the intended native workflow actually works.
