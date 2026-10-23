LAND-WITH-CHANGES

Reviewed `7a20242f..9f20ce29` on 2026-10-22 EDT. HEAD is the requested `9f20ce29`. **0 blocking, 0 major, 1 minor finding.** Round 4 M-1 is closed by the per-launch mark paths, including the native delayed-old-hook replay and built CLI refusal. Round 4 M-2 reproduces and is now the owner's accepted limit 4, not a finding. All gates pass; merge-tree against local main is conflict-free. The remaining change is a small correction to the invalid-token refusal claim in a new code comment, or explicit validation that makes that claim true.

This is a review only. The complete r5 diff was read before the author's r5 report. No tracked production or test source was changed in this worktree, and no commit, branch change, fetch, network request, push or PR was made. Native CLI probes used the built JS entry with scratch configs and stand-ins; no real agent or model turn ran. No fleet messaging or report-back send was used.

## Round 4 findings and the requested checks

| r4 finding | State | Independent evidence on r5 |
| --- | --- | --- |
| M-1: old hook replaces current unusable mark | Closed | The hook writes `.<session>.<launch token>.unusable`; the lookup reads only that last-launch path. Native replay creates both old/current files, the current file stays byte-identical, lookup refuses, and built CLI --continue exits 1 without changing the session record. |
| M-2: record and mark writes both fail | Accepted limit 4; behavior remains | With scratch conversation directory mode 0500, an actual B/clear hook with flock available changes neither the A/startup pointer nor a mark. Lookup returns A; built CLI --continue resumes A with exit 0 and no warning while the directory is still mode 0500. This is exactly the newly accepted behavior and is not counted again. |

The hook validates its session name and launch token before constructing a mark path. Valid distinct launch tokens name distinct files. Cleanup after a failed mark rename removes only that hook's temp file; it does not remove the mark. No production cleanup path for these marks was found. A failed event of the same launch can replace its own mark's reason, but the mark remains present and the refusal remains sticky. A later successful event leaves it intact. An old launch cannot replace the current launch's mark through this path.

The lookup uses the mark's **name**, not a token in its contents, as the identity. My independent built-plugin probes confirm:

- An old launch's mark does not count, even when that old path is an unreadable-as-a-file directory.
- An empty current mark refuses with “no reason given”. A current mark containing another token also refuses; its reason is used only for the explanation.
- A current mark that cannot be read fails closed: making it a directory produces an error with **EISDIR as cause**, rather than a conversation ID. Only ENOENT permits the ordinary pointer lookup.
- A non-UUID context such as `../bad-token` constructs no mark path and refuses against an ordinary UUID-token pointer. The matching-malformed-input exception to the new comment is minor finding m-1 below.

The old shared `.id.unusable` format is not a legacy fallback. That format was introduced on the unlanded r4 branch; the r5 implementation deliberately leaves it unread. Existing per-launch marks are left on disk and only the current token's path counts. This is not a cleanup protocol or a guarantee against manual deletion by another same-user process.

## New finding

### m-1 — The comment promises rejection of a non-UUID token that the equality check can accept

**Code:** `packages/plugins/agent-claude-code/src/index.ts:1461`–`:1463`, `:1504`–`:1508`.

The new comment says a non-UUID context token names no mark and “the token check below refuses its record.” The first part is true. The check below tests only nonemptiness and exact equality; it does not test UUID syntax. When both the context and pointer contain the same malformed token, the lookup returns a conversation instead of refusing it.

**Measured built-plugin reproducer:** create a scratch valid Claude conversation UUID and matching transcript; write a side record with agent=claude-code, that conversation ID, paneId=%1 and `launchToken=not-a-uuid`; call getOwnConversationId with the same non-UUID token and pane. Result: the conversation ID is returned. With a valid pointer and only the context malformed, it correctly returns id:null due to the mismatch.

This is **minor**: normal AO launches use randomUUID and the hook refuses non-UUID launch tokens, so the measured exception needs malformed/constructed matching inputs, not an ordinary hook event. It does not reopen r4 M-1 or establish a normal-path stale resume. Nevertheless the note expressly requests the non-UUID check and an audit of refusal claims, and the new comment is unconditionally stronger than the code.

**Requested change:** either qualify/remove the claim that the later equality check validates non-UUID tokens, or reject a non-UUID context explicitly and cover the matching-malformed case. No broader launch-path redesign is needed.

## Native replay and regression

Reviewer commands used env -i, HOME `/tmp/aorlr5/home`, TMPDIR `/tmp/aorlr5/tmp`, CI=1, HUSKY=0 and NPM_CONFIG_OFFLINE=true. PATH was a directory of links with installed Node, cached pnpm 9.15.4, an offline gh stub and a tmux shim adding `-L aorlr5-review`; no npm/npx or agent binary was on the gate PATH. Native stand-ins were added on a separate native path. Native tests' own -S sockets were nested through that shim. Lifecycle checks were in-process; no scratch start/spawn daemon was created.

**M-1:** the exact r4 ordering was replayed with the actual installed hook and a controlled flock shim returning failure after **1.7 s**, inside the 2-second external-step budget. L1's hook reached the shim after its process/TTY checks; L1 ended while that hook remained pending. L2 started in the same pane `%0`, recorded A/startup, then its B/clear hook without flock wrote L2's failure mark. L1's later failure wrote a separate L1 mark. Both files existed; L2's bytes equalled the saved bytes from before the old failure. Lookup returned id:null with “no flock”; after L2 ended, the built CLI --continue exited **1**, printed that reason and the recovery action, and left the session record byte-identical. Scratch launch times were aged to avoid the grace and the exported test-only process cache was reset before replacement preflight; no production source or hook was changed.

**Limit 4:** in independent session io-1, pane `%1`, A/startup recorded normally. The scratch `.agent-conversations` directory was changed to **0500**. B/clear ran with all tools, including real flock; the A pointer stayed byte-identical, no mark for that launch appeared, and lookup returned A. After the agent ended, the built CLI --continue printed A and returned **0** with empty stderr while mode 0500 remained. The directory mode was restored in finally. This verifies the accepted limit; it is not a new finding.

**Ordinary missing flock:** another real scratch relaunch recorded A, then B/clear without flock wrote its own per-launch mark. Lookup refused. Built CLI --continue exited **1** with “no flock” and the next action.

**Direct CLI send and moved pane:** after a real relaunch into `%3`, a different idle shell `%4` was selected. The built CLI send returned 0, and the agent's input log contained the complete marker-command text; the marker did not exist and `%4` still showed only its Bash prompt. After join-pane moved `%3` into move-target:

```text
runtime.getOutput: ""
runtime.sendMessage: rejects, now belongs to another tmux session; nothing sent
built CLI send: exit 1, membership reason
lifecycle recording: []
after two lifecycle checks: killed
both moved-message markers: absent
```

Thus the r4 reader/send fixes remain intact. The killed record while the moved agent survives remains the documented logical-pane-absence consequence; the stand-in was ended through its own input before cleanup.

## Limit texts, docs moves and changed oracles

Help now conditions failure refusal on a hook having **written a failure mark**, then explicitly says failure to write that mark gives no refusal. Limit 4 in help and DEVELOPMENT.md states the harm (silent older-conversation resume with success), when it happens (both writes fail, the hook never starts, or SIGKILL stops it) and the precaution (omit --continue and select /resume manually when writes or hook execution may have failed). DEVELOPMENT.md also covers the unmeasured signal Claude may use for its hook timeout. The printed conversation ID is correctly described as information, not a confirmation prompt or a freshness check. I did not execute real Claude to infer its timeout signal.

The former failed-read-or-write guarantee is removed. The hook documentation now says it **tries** to mark and expressly describes failures that leave no mark. The script comment has the same qualification. Apart from m-1's invalid-token comment, no remaining refusal promise contradicting the measured accepted limit was found. The other three owner-accepted limits remain unchanged and are not findings.

The general prose moved out of the ordering-limit paragraph was checked against `git show 7a20242f:docs/DEVELOPMENT.md`: the complete moved substring from “The external steps have a 2 s budget each” through the older-build migration sentence is **byte-for-byte unchanged** and occurs once in the new document. The new moved-pane recovery sentence preserves r4's explanation: the second poll can mark the logical session killed and run its reaction while the physical process survives elsewhere; recovery must account for both processes. It does not promise to stop the moved process.

The changed-oracle list agrees with the diff:

| Oracle change | Assessment |
| --- | --- |
| markFile/marked gain a token parameter and per-token filename | Necessary to pin the new storage identity; expected contents remain unchanged. |
| Five non-agent cases inspect every unusable filename | Stronger than checking the old single pathname; guards against accidental marks under another token. |
| Old-mark lookup test uses the old token's path; malformed contents at current path refuse | Correct: pathname now supplies identity; the old “tokenless shared mark applies to every launch” rule is intentionally gone. |
| New delayed-old-failure test | Verifies separate marks and continued refusal after the later old write. Native replay independently supplies actual overlapping hook timing. |
| New same-launch later-success test | Closes the r4 surviving mark-removal mutation gap. |
| Help oracle requires the qualified guarantee and limit 4, rejects old wording | Matches the owner's accepted change. |

No unrelated oracle was weakened. The current-mark read-error path and matching malformed context/record tokens are not pinned by these new tests.

## A surviving partial fix

In an isolated tip archive, replace only the current-mark read-error throw with `markContent = null`, so non-ENOENT failures are ignored. This incomplete implementation still uses per-launch files but accepts a pointer when the current mark is unreadable.

**All 59 selected tests pass**: Claude relaunch-conversation plus agent-pane tests **47**, CLI session-relaunch **12**. This includes both r5 test files and all new r5 cases. On an independent EISDIR probe, production rejects with that cause; the mutant returns A. No mutation was made in this worktree. This demonstrates a remaining test gap, not a production failure: the shipped catch correctly throws.

## Author's open questions

1. **Old marks and cleanup:** retaining the files is a reasonable narrow design and preserves current failure evidence. A future kill/archive cleanup must not assume that killing the logical session proves all old agents/hooks are quiescent: the accepted earlier-operation race and moved-agent case already defeat that assumption. Coordinate cleanup with launch ownership and preserve any current mark. No mark cleanup is implemented here, so this is advice on the proposed follow-up, not a new defect.
2. **No warning for limit 4 / write probe:** a present-time write probe could refuse the still-unwritable mode-0500 case I measured. It cannot prove that writes succeeded earlier, that the hook started, or that SIGKILL did not stop it. Keep that distinction if a later improvement is made; it does not replace the accepted limitation text. No such improvement is required by this narrow round.
3. **Unchanged older items:** bound Codex/Gemini still accept the documented session-missing diagnostic fallback; the check/key window remains documented; the real Claude timeout signal remains unmeasured. Older first-relaunch multi-pane, shell-configuration, stale-file and process-cache limits remain as reviewed in r4. No r5 source change alters their paths.

## Gates and merge

| Gate on 9f20ce29 | Result |
| --- | --- |
| pnpm install --frozen-lockfile --offline, cached v3 store | Exit 0 |
| pnpm build | Exit 0 |
| pnpm typecheck | Exit 0 |
| pnpm lint | Exit 0; five known warnings |
| One full pnpm -r --no-bail test | Exit 0; **3827 passed, 1 expected fail, 29 skipped** |
| SAME_ID_DEFECTS=red, all nine applicable packages | Expected nonzero; **R1 0, R2 16, R3 6, R4 0** failures |
| gitleaks git --log-opts=3e366a01..9f20ce29 --redact | Exit 0; **30 commits**, no leaks |
| git merge-tree --write-tree --merge-base 3e366a01 main 9f20ce29 | Exit 0; **no conflicting paths**; tree `590d356017953f392a81fe21b95555d798ccbed9` |

No difference from the author's totals. The only change from r4's 3825/1/29 is **Claude 363 -> 365**, the two new hook tests. Other package pass counts are unchanged: core 1711, CLI 400, Codex 317, Gemini 98, OpenCode 363, runtime-tmux 116, runtime-herdr 73, workspace 85, SCM 140, tracker 42, notifier 26, integration 91. Core supplies the one expected failure; SCM skips 5 and integration skips 24. The full gate contained no agent binary on PATH; native transcripts were kept outside HOME's Claude project directory.

Lint warnings are spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:2710 and :2717, plus the existing .eslintignore migration notice. No corrected second full run was needed. One scratch mutation command initially selected a not-yet-created working directory and never executed; after creating the archive from the existing worktree directory, the offline build and selected tests ran successfully. No product change was needed to pass a gate.

## Cleanup

Final process, state-directory and scratch-removal evidence follows below.

Server PID **490445** was checked in `/proc/490445/environ` for `HOME=/tmp/aorlr5/home` before shutdown through the isolated shim. No scratch lifecycle worker had been started. The subsequent live-process inventory for HOME under `/tmp/aorlr5/`, excluding the scanner and zombies, returned **`[]`**. The private-server check exited 1:

```text
no server running on /tmp/tmux-44402/aorlr5-review
```

The native tests removed their own private sockets, and `find /tmp/aorlr5 -type s` printed nothing. Protected workers 4027448 and 4027591 and the protected sessions were never signalled or read through their panes.

Required real-state check:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aorlr5-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Exact output:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2234
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
```

Ownership of every printed path: the `6513108c38cb-Nexus/sessions` directory, its `nex-2234` record and its `nex-orchestrator` record are external Nexus fleet writes. The `60756641ca25-agent-orchestrator/sessions` directory and its `ao-63` record are external AO fleet writes. None belongs to a review state root or was written by a review command. Mtimes do not establish an exact external writer PID; I did not read these records to attribute one. All executed CLI/core probes used the clean scratch environment and explicit scratch config/state root.

The initial and final `ls -la --time-style=full-iso ~/.ao/bin` listings are identical (`cmp` exit 0). The common listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

HEAD remains 9f20ce29 and the tracked diff is empty. The existing r4 review was not edited. Only the new requested review and watcher report were authored in the worktree; the supplied task/note remain, along with ignored outputs of the required builds and dependency install.

Final check: **SCRATCH_REMOVED** (`/tmp/aorlr5` does not exist). All owned live processes and private servers were gone before removal.
