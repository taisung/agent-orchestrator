# Codex idle send review, round 1 — ao-56

NOT-LAND-SAFE
ccec6ee4: LAND-SEPARATELY

Completed review. Range: `09546110..4ec62a0a` (four commits). Code/experiment audit using res-audit. No source edits, commits, pushes, PRs, or network gh calls are authorized.

## Isolation and initial evidence

- Created `/tmp/aocsr-marker` before review activity.
- Scratch root: `/tmp/aocsr/ao56`; fake HOME beneath it; PATH contains only scratch tool links and `/usr/bin:/bin`.
- Scratch gh accepts only `--version` and `auth status`; tmux shim forces `env -u TMUX /usr/bin/tmux -L aocsr-ao56`.
- Every node/pnpm/helper/test invocation uses `env -i`. Real agents are absent from the test PATH. No lifecycle worker or real agent will be started.
- Initial HEAD `4ec62a0a`; only `.agent_task.md` and `.agent_report.md` were untracked.
- Two early read-only inspection calls used the shell's git resolver; later git calls use `/usr/bin/git` with the fake environment.
- Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Evidence log

- Read the task, CLAUDE.md, AGENTS.md, complete production diff, and fixture module before reading the author's report. The report remains unread pending independent review of section 2.1–2.3.
- The new rescue identifies ownership by prefix only, and unconditionally accepts `[Pasted Content ...]`; test whether either can submit another sender's input.
- Activity classification now trusts an 8-row window above the composer. Test cropped captures and long composer content against a visible running turn.

### Independent source inspection (before author report)

- Install and build succeeded with fake HOME and `HUSKY=0`. Install downloaded dependencies to the fake home; it skipped hook installation. The temporary missing CLI-bin warning disappeared after build.
- All four commits are conventional and explain why; no coauthor trailer, emoji, or issue number. Parents are `09546110 → 8c4c9d81 → ccec6ee4 → fae9bbc1 → 4ec62a0a`. `git branch -r --contains 4ec62a0a` produced no output. The preassigned feature branch already contains the requested range; no branch or commit is needed for this review.
- `detectActivity` readers: CLI send idle wait and verification (`send.ts:64,333`); core delivery confirmation (`session-manager.ts:3432`); lifecycle terminal fallback (`lifecycle-manager.ts:701`); Codex `recordActivity` (`agent-codex/index.ts:606`) through `activity-log.ts:226`.
- Lifecycle first records a terminal classification, then prefers native Codex JSONL. Only missing/unparseable native JSONL reaches the AO activity fallback. Fresh `idle` stays idle (no promotion). The direct terminal fallback uses `waiting_input`, not idle, to change status. Stuck checks use the idle timestamp after PR checks (`lifecycle-manager.ts:793–848`); normal native JSONL is unaffected by the new terminal parser.
- Existing `recordTerminalActivity` refreshes an unchanged idle entry after 20 seconds. This can keep the fallback idle timestamp younger than a longer stuck threshold; that is old code and belongs in follow-ups if confirmed.
- Non-Codex delivery dispatch and the ordinary two-retry path are unchanged except for bracketed paste. Strictly byte-for-byte equivalence is not universal: old `hasUnsubmittedCodexInput` ran for every agent, and its special footer branch sent a third retry; the replacement is Codex-only. Normal Claude/Gemini screens do not use that Codex footer.

### Section 2.3 independent measurement (before author report)

- tmux 3.4, private server PID 238071, fake HOME/PATH, no AO variables at server start; all raw readers and the server were stopped by exact PID (`Own live harness processes: []`).
- Payload was `first line\n` + 280 `x` characters + `\nlast line`. Without `-p`, bytes were `first line\r...\rlast line\r`. With mode 2004 ON and `-p`: `ESC[200~first line\r...\rlast lineESC[201~\r`. Mode OFF: byte-identical with and without `-p`.
- A one-byte reader sleeping 4 ms per byte consumed the paste over 1.359 s, longer than the 300 ms Enter delay. The final Enter still followed the closing paste marker. Turning mode 2004 off upon reading the paste did not remove the already enqueued closing marker or reorder Enter.
- Installed Claude Code 2.1.306 strings include paste-start/end parsing, explicit bracketedPaste enable/reset/reassert, and another internal PTY-send path that wraps text then writes CR. Installed Codex 0.163.0 strings contain enable/disable mode 2004 and both paste delimiters, including an assertion for a `[200~` buffer prefix. Installed Gemini bundle contains enable/disable, paste-start/end, `bufferPaste`, a 30 s inter-key paste timeout, and CR-to-LF normalization on paste insertion. None of these binaries were executed. The shell's `gemini` launcher is a local wrapper, so the independently installed Google bundle was inspected directly.
- These probes prove transport order, not an application acknowledgement. A live application's focus, remount, paste expansion, and submission after Enter still require the owner's real-pane check. No measured transport regression in `-p`; provisional recommendation is to land that transport correction separately if the Codex verification changes need revision.
- Sections 2.1–2.3 independent source review and transport probes are now complete; the author's report can be read after this entry.

### Initial independent replay and gate results

- Full `pnpm -r --no-bail test`: exit 0, **2958 passed, 4 expected fail, 29 skipped**. Targeted CLI: 22 files / 278 tests passed; Codex: 4 files / 231 tests passed. Build and typecheck exit 0. Lint exit 0 with 5 pre-existing warnings, no errors, none in changed files.
- The private-server replay completed and stopped its own processes. The captured 281-character notice now receives 1 retry Enter and transitions to the running screen. Base receives no retry and incorrectly prints processing with the notice still visible.
- Plain unrelated ghost text receives no retry at HEAD; a running row above the composer receives no retry at either revision. These are controls, not proof of ownership.
- Counterexamples confirmed live on the private server: ghost composer `› Your` and unrelated `› [Pasted Content 900 chars]` both receive **two retry Enters** at HEAD for the 281-character outgoing notice. Base gives zero retry Enters for both idle screens. This round therefore makes the foreign-input submission risk worse.
- In another replay the first Enter leaves the notice and the retry merely clears it, without drawing any running turn. HEAD still prints `Message sent and processing`. This is a new confirmation branch accepting a transition that also means deletion; the author's existing test explicitly endorses that ambiguous transition.

### Author's deviations independently checked

Read only the relevant Bash tool-use records from the author's Claude transcript `~/.claude/projects/-home-taisung--worktrees-agent-orchestrator-ao-54/18b54b90-39e8-4603-9c23-693a53fe7b47.jsonl` with grep, then parsed the extracted records under the fake environment. Did not execute any historical command.

- 18:20:23Z: unsanitized `node -e 'console.log("x".length)'` has no filesystem write. The following notice-length command used `env -i` (PATH only), also no write.
- 18:20:37Z: unsanitized node reads and writes only the literal relative path `packages/plugins/agent-codex/src/__fixtures__/panes-0.163.0.ts` while cwd is the author's worktree. No AO API or external module is imported.
- 18:28:47Z: there are **two** unsanitized `prettier --check` invocations in one compound Bash call, rather than just one invocation. Both are checks, with no `--write`/`--cache`. The surrounding shell also executes `git show ... > /tmp/aocs/base-index.ts`, which writes the author's scratch file outside the worktree; that is not a Prettier write and not a real-state write. The same command includes `git stash list`, which reads only, but did violate the brief's blanket prohibition on any stash command. No destructive stash command ran.
- These command bodies support the claimed absence of real-state writes by the deviations. They are not a syscall audit of every file touched by the author's entire session. No need to rerun the unsafe commands to verify them.

### Same-ID regression check

Independent `SAME_ID_DEFECTS=red` runs using local Vitest on both HEAD and archived `09546110` give identical failures: **R1 0, R2 8, R3 6, R4 11**. All 25 failure names match between revisions. The ordinary full suite leaves these expected defects marked as before.

### Independence from ccec6ee4

Applied patches for `8c4c9d81`, `fae9bbc1`, `4ec62a0a` sequentially to a `git archive 09546110` scratch copy: all apply cleanly. However, the unmodified three-commit variant fails **5 of the 9 new CLI tests**, because fae9bbc1's `PASTE` constant includes `-p`. The runtime change is not required by the rescue logic, but the commits are not test-independent as written. A scratch-only one-line adaptation of that constant to omit `-p` is being checked with both full targeted suites. If -p is omitted, docs/DEVELOPMENT.md:229–232 must say `paste-buffer` without brackets and explain that embedded LF is delivered as CR; remove the claim that newline cannot act as Enter. No production source fix was made by this review.

## Verdict and findings

**NOT-LAND-SAFE** — 2 blockers, 2 majors, 1 minor. Only the blockers and majors below drive this verdict; old unchanged defects are separately listed as F-n.

**ccec6ee4: LAND-SEPARATELY** — the bracketed-paste transport change passed the independent byte/order probes and is supported by the installed agents' parsers. It has no demonstrated transport regression here. Separate it from the unsafe Codex ownership/confirmation changes so it can be reviewed and reverted on its own across all agent panes. This is not a claim that a stub proves a real application's submission. Run the explicit post-landing real-pane check below. The current four-commit range must not land together as-is.

### B-1 — The new ownership predicate submits other senders' drafts and opaque paste blocks

- **Files:** `packages/cli/src/commands/send.ts:110–113`, `:417–422`; misleading guarantee at `:106–108` and `docs/DEVELOPMENT.md:238–240`.
- **Category:** made worse by this round. Both new helpers and this rescue branch are changed code. In the base these idle screens falsely read active but receive no retry Enter; HEAD now actively submits their text.
- **Evidence:** send the captured 281-character notice while verification sees `› Your` (another sender's incomplete draft). `notice.startsWith("Your")` accepts it. HEAD sends two extra Enters; base sends none. Whitespace collapsing and inspecting only one displayed line also hide differences in wrapped/multiline content. An unrelated `› [Pasted Content 900 chars]` is accepted even when the outgoing message is only `hello`; the placeholder branch does not check the size or contents at all. A human edit, a competing sender, or stale/ghost text can supply either screen.
- **Reproducer:** in the scratch copy's CLI test harness, set `screens` to `"  Worked for 15m 54s • 12:24 PM\n\n› Your\n\n  Context 68% used\n  ⚠ 2 warnings · f2 to view\n"`; call `send("--no-wait", "codex-1", UNSUBMITTED_NOTICE_0163)`; `expect(retryKeys()).toEqual([])` fails with two `ENTER` vectors. Replace `Your` with `[Pasted Content 900 chars]` and send `hello`: same failure. Private tmux replay independently confirms both cases (table below).
- **Needed:** do not treat prefix similarity or an opaque paste marker as ownership. Preserve independent evidence tying the observed input to this dispatch, serialize AO sends to the pane, and decline the retry when another edit/paste cannot be excluded. AO serialization alone does not exclude a human edit. Add these negative cases, not only a completely unrelated first line.

### B-2 — Pasted transcript text can hide a visible running turn and trigger retry Enter

- **Files:** `packages/plugins/agent-codex/src/index.ts:348`, `:372–392`, `:478–480`; duplicated composer search in `packages/cli/src/commands/send.ts:85–96`.
- **Category:** made by this round. Base classifies this screen active; HEAD classifies it idle. This is an independently constructed valid-shape screen, not a claimed captured real-agent incident.
- **Reproducer screen:**

```text
◦ Working (5m 47s • esc to interrupt)
› examine this transcript
  Worked for 1s
  › examine this transcript
  tab to queue message
```

The outer `›` is the composer; the next two indented lines are user content quoting a transcript. The regex also accepts the indented inner prompt and selects it as the composer. `hasRunningTurnAbove` stops at the quoted `Worked for` line before reaching the genuine running row. For an outgoing message starting `examine this transcript`, the send loop's equally mistaken parser accepts the inner prompt and sends two retry Enters into the running turn. An added CLI safety assertion and plugin assertion both fail. The private-server single-line replay has 3 total Enters at HEAD versus 1 at base; all screenshots retain the running row.

`recordActivity` followed by `getActivityState` with the native signal absent also returns fresh `idle` for this screen. The normal native JSONL branch is unaffected, but the idle wait and terminal fallback can now call a live turn idle. Recognize the actual composer boundary/continuation indentation and preserve explicit current running evidence when layout is ambiguous. Share the parser so the activity and resend paths cannot select different regions.

### M-1 — Text disappearance, and even a hint inside nonempty pasted text, is treated as processing

- **Files:** `packages/cli/src/commands/send.ts:92–96`, `:403–410`; current positive test at `packages/cli/__tests__/commands/send-codex.test.ts:179`.
- **Category:** left in changed code: the empty-composer inference and the new success branch are part of this fix. The old unconditional active default is not the finding here.
- **Evidence/reproducer A:** checks show the real unsubmitted notice, then the real empty idle screen. A private stub clears the notice on the retry without starting a turn. HEAD prints `Message sent and processing`. This observation is equally compatible with another sender's C-u or a UI reset deleting the message; it proves disappearance, not receipt. The new positive test encodes that unsupported inference.
- **Evidence/reproducer B (no deletion required):** send `Describe this UI\n? for shortcuts means help`. Return composer `› Describe` on check 1 and `› Describe this UI\n  ? for shortcuts means help\n  Context 68% used\n  ⚠ 2 warnings · f2 to view` on check 2. The message is still in the composer, but the body contains the supposed empty hint, so `readCodexComposer` says empty and the loop prints processing. The scratch test expecting no processing fails.
- **Needed:** distinguish the footer from message continuation rows; a nonempty first composer line must not be erased by a substring elsewhere below it. Report unconfirmed delivery when all that is known is disappearance, unless an agent event/transcript acknowledgement establishes receipt.

### M-2 — The new numbered-row guard also rejects ordinary numbered user messages

- **Files:** `packages/plugins/agent-codex/src/index.ts:376`; `packages/cli/src/commands/send.ts:91`.
- **Category:** left in changed code. Base had the broad false-active default, but this round adds explicit guards that preserve that defect for a common message shape in the exact composer path being fixed. The old approval recognizers themselves remain follow-ups (F-1).
- **Reproducer:** `"  Worked for 1s\n› 1. Summarize the test failures\n  Context 68% used\n  ⚠ 2 warnings · f2 to view\n"` has an idle composer and no menu/question. Both revisions return active; HEAD's new guard rejects the composer purely because its text begins `1. `. The new send confirmation still prints processing with unsubmitted numbered instructions. The scratch expected-idle assertion fails.
- **Needed:** distinguish an actual selection list using surrounding layout/options, not just a numbered first line; on insufficient evidence do not assert processing. Add a numbered message control beside the existing selection-menu test. Author follow-up 9 belongs here because the rejecting rule is newly written.

### m-1 — The three other commits do not pass unchanged without ccec6ee4

- **File:** `packages/cli/__tests__/commands/send-codex.test.ts:61` (fae9bbc1).
- **Category:** made by this round; test coupling, not a production transport dependency.
- **Reproducer:** archive the base and apply `8c4c9d81`, `fae9bbc1`, `4ec62a0a`. All three patches apply, but the 9-test CLI file gives 4 passed / 5 failed, solely on the `PASTE` vector's `-p` argument. Changing the scratch copy's single `PASTE` constant to `["paste-buffer", "-t", PANE]` makes **all 278 CLI and 231 Codex tests pass**. No production code adaptation is needed for this separation.
- **Needed:** make that test expectation follow the selected transport commit and update the docs' bracketed-paste paragraph if ccec6ee4 is excluded. Do not claim the raw three-commit selection already passes.

## Follow-ups and the author's items 5–9

| ID | File:line | Disposition and evidence |
| --- | --- | --- |
| F-1 | `packages/plugins/agent-codex/src/index.ts:460–463,502` | Author item 5: unchanged approval recognition misses the 0.163.0 numbered approval view, so it remains active rather than waiting_input. Base and HEAD agree on the derived selection screen. No new failure of the old approval predicates; follow up independently. The old approval-word match also reads literal `approval required` in composer text as waiting_input in both revisions. |
| F-2 | `packages/cli/src/commands/send.ts:426–429` | Author item 6: the unchanged generic retry still sends Enter on an unknown/no-composer non-active screen, including old approval prompts. Same behavior at base; not a new landing blocker. B-2 instead concerns a new false idle classification feeding a new composer rescue. |
| F-3 | `packages/cli/src/commands/send.ts:67–68` | Author item 7: `Press up to edit queued messages` does not recognize Codex's `edit last queued message`; predicate unchanged. The existing active-first branch can hide this miss, also unchanged. |
| F-4 | `packages/cli/src/commands/send.ts:157,160,166` | Author item 8: unnamed automatic tmux buffer and timestamp-only temp filename are old shared-state races. The underlying load/paste selection is unchanged by adding mode markers. A competing send can replace the top buffer; it needs a named buffer and per-pane serialization. The new extra-Enter consequence when that foreign buffer is displayed is already blocking under B-1, rather than being excused as a follow-up. |
| F-5 | `packages/core/src/activity-log.ts:250–262`; `packages/core/src/lifecycle-manager.ts:538–546` | Fresh identical idle recordings refresh the fallback timestamp after 20 s. With native data unavailable, a stuck threshold longer than that refresh may never expire. Independently seeded a 30-minute-old idle entry, then recorded the same idle screen: the fallback timestamp became current. This code and suppression mechanism predate the range. |
| F-6 | `packages/cli/src/commands/send.ts:393–395` | The unchanged active-first success branch can print processing for an unrelated already-running turn even if the new message is lost. Both base and HEAD do this; it is not proof of receipt. No new retry occurs for the ordinary mid-turn fixture. |

Author item 9 is **M-2**, not an unchanged-code follow-up: the explicit numbered-composer exclusion is newly added at both named lines. The author's items 5–8 do not independently change the verdict, but item 8 supplies an additional source of foreign input for B-1.

## Classification matrix (independent built modules)

| Screen | Base | HEAD |
| --- | --- | --- |
| captured idle | active | idle |
| captured unsubmitted | active | idle |
| running text | active | active |
| running empty | active | active |
| old Working above finished turn | active | idle |
| Working inside message | active | idle |
| selection | active | active |
| numbered message | active | active |
| no composer | active | active |
| old bare | idle | idle |
| old footer | idle | idle |
| nested prompt in running composer | active | idle |
| approval text inside composer | waiting_input | waiting_input |

The two fixture literals were independently byte-equal to the read-only capture files. All 20 new tests were read: 11 plugin classifications and 9 CLI sequences. The existing older-form tests also pass. The additional seven safety assertions fail on the final tree: five CLI assertions (B-1 twice, B-2, M-1 twice), and two plugin assertions (B-2, M-2). These failures are independent adversarial tests in scratch, not changes to the shipped suite.

## Mutant table

Each mutation starts from the restored 4ec62a0a source in a git-archive scratch tree. Local Vitest only, fake HOME/PATH, no AO variables. The control is plugin `index.test.ts` 174 passed and CLI `send-codex.test.ts` 9 passed.

| Mutation | Failed tests |
| --- | --- |
| Remove the composer-rule branch | 13 failures: Plugin: `detectActivity on Codex 0.163.0 screens returns idle for the real idle screen (placeholder and '? for shortcuts' footer)`<br>Plugin: `detectActivity on Codex 0.163.0 screens returns idle for the real screen whose composer holds an unsubmitted paste`<br>Plugin: `detectActivity on Codex 0.163.0 screens returns idle when an old running-turn row is in the scrollback far above the composer`<br>Plugin: `detectActivity on Codex 0.163.0 screens reads the running-turn row only in the 8 lines above the composer`<br>Plugin: `detectActivity on Codex 0.163.0 screens stops at the 'Worked for' line: the text of a finished turn is not a running turn`<br>Plugin: `detectActivity on Codex 0.163.0 screens never reads the composer text or the footer as activity`<br>CLI: `ao send to a Codex 0.163.0 pane sends one more Enter to the unsubmitted paste and prints processing once the turn runs`<br>CLI: `ao send to a Codex 0.163.0 pane prints processing when the composer is empty after its Enter (Codex took the message)`<br>CLI: `ao send to a Codex 0.163.0 pane prints the could-not-confirm line when the paste stays in the composer`<br>CLI: `ao send to a Codex 0.163.0 pane sends no Enter and does not print processing for an idle empty composer`<br>CLI: `ao send to a Codex 0.163.0 pane sends no Enter to composer text that is not this message`<br>CLI: `ao send to a Codex 0.163.0 pane sends one more Enter to a paste that Codex shows as [Pasted Content ...]`<br>CLI: `ao send to a Codex 0.163.0 pane does not wait for an idle Codex pane before it sends` |
| Scan all rows above the composer (stop=0) | 1 failures: Plugin: `detectActivity on Codex 0.163.0 screens reads the running-turn row only in the 8 lines above the composer` |
| Accept any composer text | 1 failures: CLI: `ao send to a Codex 0.163.0 pane sends no Enter to composer text that is not this message` |
| Remove -p | 6 failures: CLI: `ao send to a Codex 0.163.0 pane sends one more Enter to the unsubmitted paste and prints processing once the turn runs`<br>CLI: `ao send to a Codex 0.163.0 pane prints processing when the composer is empty after its Enter (Codex took the message)`<br>CLI: `ao send to a Codex 0.163.0 pane sends no Enter and does not print processing for an idle empty composer`<br>CLI: `ao send to a Codex 0.163.0 pane keeps the mid-turn case: a running turn above the paste prints processing with no Enter`<br>CLI: `ao send to a Codex 0.163.0 pane does not wait for an idle Codex pane before it sends`<br>CLI: `send command message delivery uses load-buffer for long messages` |
| Send Enter after Codex check 3 (only the composer branch) | 1 failure: `ao send to a Codex 0.163.0 pane prints the could-not-confirm line when the paste stays in the composer` |

The first exploratory check-3 mutant changed both retry guards and additionally failed the ordinary Claude retry control. The table reports the narrower required Codex-only mutation. Killing all five mutants proves that the intended branches have tests; it does not cover the new ownership/layout counterexamples.

## Private-server live replay

All CLI invocations were `env -i HOME=/tmp/aocsr/ao56/home PATH=/tmp/aocsr/ao56/bin:/usr/bin:/bin LANG=C.UTF-8 TERM=xterm-256color TMPDIR=/tmp/aocsr/ao56/tmp AO_STATE_ROOT=/tmp/aocsr/ao56/state AO_CONFIG_PATH=/tmp/aocsr/ao56/agent-orchestrator.yaml node <build>/packages/cli/dist/index.js send --no-wait <scratch-session> -f <scratch-message>`. The tmux shim always selected `aocsr-ao56`. Scratch metadata was written directly; no spawn/start/restore/lifecycle command ran.

The standalone raw Python program enabled mode 2004, drew the fixture, logged every received byte, and either kept or changed the screen on a counted Enter. These are scripted replay controls, not real-agent acceptance tests. New build is the full worktree `pnpm build`; base uses archived sources with the unchanged packages copied from that build and the two differing modules emitted with the same local TypeScript compiler. Separate `tsc -p` checks of base CLI/Codex and no-p CLI/Codex all exited 0. Compiler calls ran from the reviewer worktree and emitted only scratch outputs; the primary checkout was not built or modified.

| Case | Build | Initial + retry Enters | Final CLI line |
| --- | --- | --- | --- |
| unsubmitted | head | 1 + 1 | Message sent and processing |
| unsubmitted | base | 1 + 0 | Message sent and processing |
| ghost | head | 1 + 0 | Message sent — could not confirm it was received |
| ghost | base | 1 + 0 | Message sent and processing |
| midturn | head | 1 + 0 | Message sent and processing |
| midturn | base | 1 + 0 | Message sent and processing |
| prefix | head | 1 + 2 | Message sent — could not confirm it was received |
| prefix | base | 1 + 0 | Message sent and processing |
| placeholder | head | 1 + 2 | Message sent — could not confirm it was received |
| placeholder | base | 1 + 0 | Message sent and processing |
| lost-after-retry | head | 1 + 1 | Message sent and processing |
| lost-after-retry | base | 1 + 0 | Message sent and processing |
| nested | head | 1 + 2 | Message sent — could not confirm it was received |
| nested | base | 1 + 0 | Message sent and processing |

The table uses a single-line outgoing message for the nested case, to isolate retry Enters. An earlier multiline control at base also produced two CR bytes from the payload before the initial Enter (the old unbracketed transport); those are not verification retries.

### (a) The incident

Before, both builds:

```text
› Ask Codex to do anything

  ao-51 · weekly 75% left · GPT-6-Astra xhigh · Context 55% used · 6.98M in
  ? for shortcuts                                                       ⚠ 2 warnings · f2 to view
```

After HEAD:

```text
• Review complete: R2 NOT-SOUND; R3 NOT-SOUND; R4 SOUND-WITH-CHANGES. Found 7 blockers and 4 major
  Worked for 15m 54s • 12:24 PM

› Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2
  by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously
  through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.

◦ Working (5m 47s • esc to interrupt)

› Ask Codex to do anything

  ao-51 · weekly 75% left · GPT-6-Astra xhigh · Context 55% used · 6.98M in
  ? for shortcuts                                                       ⚠ 2 warnings · f2 to view
```

After base:

```text
• Review complete: R2 NOT-SOUND; R3 NOT-SOUND; R4 SOUND-WITH-CHANGES. Found 7 blockers and 4 major
  Worked for 15m 54s • 12:24 PM

› Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2
  by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously
  through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.

  ao-51 · weekly 77% left · GPT-6-Astra xhigh · Context 68% used · 3.64M in
                                                                        ⚠ 2 warnings · f2 to view
```

### (b) Nonmatching ghost input

Before, both builds:

```text
  Worked for 15m 54s • 12:24 PM

› a completely unrelated human draft

  ao56 · GPT-6-Astra · Context 68% used
  ⚠ 2 warnings · f2 to view
```

After, both builds (no verification Enter):

```text
  Worked for 15m 54s • 12:24 PM

› a completely unrelated human draft

  ao56 · GPT-6-Astra · Context 68% used
  ⚠ 2 warnings · f2 to view
```

### (c) A running turn

Before, both builds:

```text
• Review complete: R2 NOT-SOUND; R3 NOT-SOUND; R4 SOUND-WITH-CHANGES. Found 7 blockers and 4 major
  Worked for 15m 54s • 12:24 PM

◦ Working (5m 47s • esc to interrupt)

› Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2
  by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously
  through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.

  ao-51 · weekly 77% left · GPT-6-Astra xhigh · Context 68% used · 3.64M in
  tab to queue message                                                  ⚠ 2 warnings · f2 to view
```

After, both builds (no verification Enter):

```text
• Review complete: R2 NOT-SOUND; R3 NOT-SOUND; R4 SOUND-WITH-CHANGES. Found 7 blockers and 4 major
  Worked for 15m 54s • 12:24 PM

◦ Working (5m 47s • esc to interrupt)

› Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2
  by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously
  through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.

  ao-51 · weekly 77% left · GPT-6-Astra xhigh · Context 68% used · 3.64M in
  tab to queue message                                                  ⚠ 2 warnings · f2 to view
```

prefix screen before and after, both builds (HEAD alone sends retry Enters):

```text
  Worked for 15m 54s • 12:24 PM

› Your

  ao56 · GPT-6-Astra · Context 68% used
  ⚠ 2 warnings · f2 to view
```

placeholder screen before and after, both builds (HEAD alone sends retry Enters):

```text
  Worked for 15m 54s • 12:24 PM

› [Pasted Content 900 chars]

  ao56 · GPT-6-Astra · Context 68% used
  ⚠ 2 warnings · f2 to view
```

The deletion case starts with the same empty fixture, shows the unsubmitted fixture after the initial Enter, then returns to the empty fixture on the retry without starting a turn. The nested case is quoted verbatim under B-2; the before and after captures are identical in both builds.

## Gates and commit checks

Commands ran under `env -i HOME=/tmp/aocsr/ao56/home PATH=/tmp/aocsr/ao56/bin:/usr/bin:/bin LANG=C.UTF-8`; install added `HUSKY=0`. Tests had no AO variables and no agent executable on PATH. pnpm resolved the package-local Vitest binaries.

```text
pnpm install --frozen-lockfile: exit 0
pnpm build: exit 0 (12 build: Done)
pnpm --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-agent-codex test: exit 0
  CLI: Test Files 22 passed (22); Tests 278 passed (278)
  Codex: Test Files 4 passed (4); Tests 231 passed (231)
pnpm lint: exit 0; 5 problems (0 errors, 5 warnings)
pnpm typecheck: exit 0 (13 typecheck: Done)
pnpm -r --no-bail test: exit 0
packages/core test:       Tests  1392 passed | 4 expected fail (1396)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  231 passed (231)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:       Tests  38 passed (38)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  52 passed (52)
packages/plugins/workspace-worktree test:       Tests  65 passed (65)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  278 passed (278)
TOTAL: 2958 passed, 4 expected fail, 29 skipped
SAME_ID_DEFECTS=red HEAD: R1 0, R2 8, R3 6, R4 11
SAME_ID_DEFECTS=red base: R1 0, R2 8, R3 6, R4 11
without-p raw new CLI tests: 4 passed, 5 failed (transport vector only)
without-p after one test-constant adaptation: CLI 278 passed, Codex 231 passed
```

The four commit messages have conventional prefixes, explain why in their bodies, and contain no coauthor trailer, emoji, or issue number. The range is a straight line and `git branch -r --contains 4ec62a0a` prints nothing. No commit, push, PR, rebase, worktree creation, or network gh call was made.

## Post-landing check for the orchestrator (not run by this reviewer)

For ccec6ee4, make one send to an **idle real pane of each agent type**: Codex 0.163.0, Claude Code 2.1.306, and the actual Gemini CLI 0.45.1 (not the local `gemini` shell wrapper that launches Claude). Use an existing recorded session for each; do not infer its type from the wrapper's name.

Prepare one file with a unique smoke marker, more than 200 characters, and at least two lines. Ask the agent only to echo the marker and confirm the two lines, without tools. For each idle session, run exactly one `ao send --no-wait <session> -f <file>` using the rebuilt selected transport. Inspect the visible transcript and composer: both lines must appear as one complete user message, with the same text, no literal escape markers, no message left in the composer, no separate submission at the embedded newline, and exactly one resulting turn. The CLI's green line alone is not a pass. Preserve the before/after capture and the selected agent version. If a paste is lost or Enter does not submit it, retain the evidence and revert/revise the separate transport commit before wider use.

The private slow-reader test establishes that queued Enter cannot overtake the closing marker. Only this live check can establish that each real agent's current focus, paste processing, expansion, and submission handlers still accept it. Installed strings and a raw byte reader cannot prove that application-level fact.

## What is correct

- The two captured 0.163.0 idle screens now read idle; the original unsubmitted-notice replay gets a checked retry and reaches the running screen.
- Ordinary running-turn fixtures remain active and get no verification Enter. The finished-turn boundary prevents stale Working text from making those idle captures active.
- An unrelated non-prefix literal draft is left alone, and an always-empty composer that never showed the message produces an unconfirmed line.
- The normal retry is bounded to two checked Enters. All required mutants are killed, and all project gates and same-ID baseline comparisons pass.
- `-p` preserves payload ordering, wraps only for panes that enabled bracketed paste, and leaves mode-off bytes unchanged. It covers multiline messages as well as the over-200-character path; the short single-line path is unchanged.

## Scope and limits

No actual Codex/Claude/Gemini/OpenCode agent was run. No opencode command, model turn, real-config AO command, or real-state write was performed. The report relies on source inspection, installed-binary strings, the captured idle screens, explicitly derived counterexamples, mocked unit tests, and isolated tmux replay. There was no captured running screen beyond the brief's quoted running row, so derived-layout findings are clearly identified. No source file in the worktree was changed. The only new review deliverables are this file and `.agent_report.md`; the preassigned task file remains untouched. The author's `/tmp/aocs` remains read-only and was not removed.

The source change is not byte-for-byte identical for every possible non-Codex screen: old `hasUnsubmittedCodexInput` applied without checking the agent name and could send a third retry if a non-Codex screen happened to contain a Codex-style prompt/footer. The new code uses two generic retries instead. Normal Claude/Gemini control behavior is preserved by the tests, and their core delivery/API dispatch paths are unchanged. This exceptional reduction in extra keys is not treated as an additional blocker.

## Final cleanup and real-state audit

Stopped each private raw reader by its exact recorded PID, then its private tmux server by exact PID. No lifecycle worker was started. Never signaled a real fleet process or used a name-pattern kill. The harness recorded 168 short-lived CLI/tmux/client/server/reader PIDs across the probe and replay runs; all are gone. The process scan excludes only the inspecting helper and its ancestors. After the helper returns, it also exits.

```text
Recorded live processes: []
Recorded zombies: []
Own live processes: []
Live test-root PIDs: []
```

Some tests create PID-scoped state directly under `/tmp` because `NODE_ENV=test` overrides the normal state root while AO variables are absent. Removed the exact review-owned test roots after matching their timestamps to the logged targeted/full/same-ID/no-p runs and checking their PIDs were gone. Their suffixes were:

```text
155093, 199618, 199619, 199621, 199622, 199628, 199634, 199646, 199675, 199681, 199696, 199713, 199718, 199736, 199737, 199753, 199757, 199775, 199777, 199780, 199797, 199823, 199829, 199830, 199838, 199922, 200024, 200211, 200338, 200409, 221633, 221714, 221738, 269996, 279808, 319958
```

Also removed `/tmp/ao-plugin-registry-W00zxG` after verifying its two files are the synthetic `role-qa` fixture from `core/src/__tests__/plugin-registry.test.ts:537`. Other agents' scratch roots, the author's `/tmp/aocs`, and unrelated `/tmp` entries were not touched. Removed `/tmp/aocsr/ao56`, its fake HOME, scratch configs/state, stubs, replay logs, archived copies and mutants, the review marker, and the stale private socket if present. All decision evidence, commands, test names and before/after pane captures needed for this review are retained above. No source changes: `git diff --exit-code` returned 0 before publication.

The required command at the end was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aocsr-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-57
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54

```

Every printed path is attributed:

- `.../sessions/ao-54`: external fleet activity, not this reviewer. The first audit found generation 5, `status=stuck`, mtime `2026-10-21 14:50:58.186497681 -0400`. The real lifecycle worker **3624110** explicitly logged its working-to-stuck transition. While this review was finalizing, the record became generation 6, `status=working`, mtime `2026-10-21 15:03:28.488474180 -0400`. That later refresh is consistent with the worker's polling schedule or the author's own Claude hooks; the available log does not uniquely identify that last writer. All reviewer CLI calls used the isolated state/config, and none targeted this record.
- `.../sessions/ao-57`: the orchestrator's separately spawned session and real lifecycle initialization, not this reviewer. It was created at `2026-10-21T19:04:13.000Z` and is generation 4, `status=working`, `agent=codex`, mtime `2026-10-21 15:04:28.752707001 -0400`. This reviewer ran no spawn command. Its independently created worktree has a task file timestamped 15:04.
- `.../sessions`: directory mtime `2026-10-21 15:04:28.753706971 -0400`, from that external session metadata replacement.

No other path was printed. The first finalization attempt deliberately stopped before cleanup/publication when ao-57 newly appeared; the final check includes and attributes all three paths. This is a read-only attribution from metadata, timestamps and the lifecycle log, not a syscall audit of the other sessions.

Final `ls -la --time-style=full-iso ~/.ao/bin`, byte-identical to the initial saved listing (`diff -u` empty):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

No commit, push or PR was made, as this review brief requires. Final report publication is an atomic rename after cleanup.
