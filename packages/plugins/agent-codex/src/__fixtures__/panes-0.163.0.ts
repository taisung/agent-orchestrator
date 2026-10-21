/**
 * Codex 0.163.0 TUI screens (`codex --version`: codex-cli 0.163.0) for the
 * screen tests of `detectActivity` and of `ao send`.
 *
 * Provenance of the two real captures: `capture-pane -p` of the ao-51 pane
 * (Codex, GPT-6-Astra) on 2026-10-21, kept byte for byte:
 * - REAL_UNSUBMITTED_PASTE_0163 (about 13:37 EDT): the notice of `ao send
 *   --no-wait ao-51` (over 200 characters) still in the composer after `›`, with no
 *   running-turn row and no "? for shortcuts". Codex recorded the notice only
 *   at 13:38:13, after one bare Enter.
 * - REAL_IDLE_EMPTY_0163 (14:01 EDT): an idle pane with the placeholder
 *   `› Ask Codex to do anything`, the status line, and the footer
 *   `? for shortcuts` with `⚠ 2 warnings · f2 to view`.
 *
 * The DERIVED screens are not captures: each one changes a real capture as its
 * comment says, to show a state that no real capture of this version holds.
 */
export const REAL_UNSUBMITTED_PASTE_0163 =
  "\u2022 Review complete: R2 NOT-SOUND; R3 NOT-SOUND; R4 SOUND-WITH-CHANGES. Found 7 blockers and 4 major\n  Worked for 15m 54s \u2022 12:24 PM\n\n\u203a Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2\n  by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously\n  through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.\n\n  ao-51 \u00b7 weekly 77% left \u00b7 GPT-6-Astra xhigh \u00b7 Context 68% used \u00b7 3.64M in\n                                                                        \u26a0 2 warnings \u00b7 f2 to view\n";

export const REAL_IDLE_EMPTY_0163 =
  "\u203a Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r\u2026\n\n\u2022 Ran env -i HOME=/tmp/aosdr2/home PATH=/tmp/aosdr2/bin:/usr/bin:/bin LANG=C.UTF-8 node /tmp/aosd\u2026\n  \u2514 Recorded PIDs still present: []\n    Own live processes: []\n    Recorded process count: 45\n    + Show details\n\n\u2022 Ran ls -la --time-style=full-iso ~/.ao/bin > /tmp/aosdr2/logs/ao-bin-after.txt; diff -u /tmp/ao\u2026\n  \u2514 /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive\n    /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52\n    /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations\n    + 12 lines (^t to expand)\n\n\u2022 Ran stat --format='%n | %y | %s bytes' /home/taisung/.agent-orchestrator/f6790d5546be-agent-ski\u2026\n  \u2514 -rw-r--r-- 1 taisung users 682 2026-10-21 12:26:01.275814283 -0400 ao-49_2026-10-21T16-26-01-\u2026\n    -rw-r--r-- 1 taisung users 681 2026-10-21 12:02:48.504234336 -0400 ao-48_2026-10-21T16-02-48-\u2026\n    2026-10-21 13:38:27.371980273 -0400\n    + 20 lines (^t to expand)\n\n\u2022 Ran rg -n '^### [BMm]-|^R[234]|^Review' development/reviews/same_id_design_review_r2_astra6.md;\u2026\n  \u2514 129:### M-3 \u2014 Legacy association and retirement are not yet a complete R2b feature\n    139:### m-1 \u2014 R4 should preserve malformed git answers as unknown\n    /tmp/tmux-44402/aosdr2-test socket\n    + 13 lines (^t to expand)\n\n\u2022 Added /tmp/aosdr2/finalize.mjs (+111 -0)\n      1 +import {readFileSync,writeFileSync} from 'node:fs';\n      2 +const root='/home/taisung/.worktrees/agent-orchestrator/ao-51';\n      3 +const file=root+'/development/reviews/same_id_design_review_r2_astra6.md';\n    + Show details\n\n\u2022 Ran env -i HOME=/tmp/aosdr2/home PATH=/tmp/aosdr2/bin:/usr/bin:/bin LANG=C.UTF-8 node /tmp/aosd\u2026\n  \u2514 Review finalized and report staged; scratch cleanup and atomic publication remain.\n    + Show details\n\n\u2022 Ran sed -n '1,30p' development/reviews/same_id_design_review_r2_astra6.md; head -n 8 .agent_rep\u2026\n  \u2514 Own live processes: []\n    Recorded process count: 45\n    628e0fbfa11c6793d5d1e2a3002202a1551551b7\n    + 39 lines (^t to expand)\n\n\u2022 Ran env -i HOME=/tmp/aosdr2/home PATH=/tmp/aosdr2/bin:/usr/bin:/bin LANG=C.UTF-8 node --input-t\u2026\n  \u2514 ?? .agent_task.md\n    ?? development/reviews/same_id_design_review_r1_astra6.md\n    ?? development/reviews/same_id_design_review_r2_astra6.md\n    + 3 lines (^t to expand)\n\n\u2022 Completed and reported in .agent_report.md (.agent_report.md).\n\n  Review found 5 blockers, 3 majors and 1 minor. All 50 tests ran; scratch processes and files\n  were cleaned up. No commit or PR created, as required by the brief.\n\n  Worked for 18m 30s \u2022 1:56 PM\n\n\n\u203a Ask Codex to do anything\n\n  ao-51 \u00b7 weekly 75% left \u00b7 GPT-6-Astra xhigh \u00b7 Context 55% used \u00b7 6.98M in\n  ? for shortcuts                                                       \u26a0 2 warnings \u00b7 f2 to view\n";

/** The notice that REAL_UNSUBMITTED_PASTE_0163 holds in its composer (281 characters). */
export const UNSUBMITTED_NOTICE_0163 =
  "Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2 " +
  "by ao-52. Your worktree is now at 628e0fbf. Read the brief in full and execute it autonomously " +
  "through to the deliverable. Report via .agent_report.md when done, no mid-task ACK needed.";

/** The running-turn row of a real Codex pane, as the task brief of 2026-10-21 quotes it. */
export const RUNNING_ROW_0163 = "◦ Working (5m 47s • esc to interrupt)";

const UNSUBMITTED_LINES = REAL_UNSUBMITTED_PASTE_0163.split("\n");
const UNSUBMITTED_COMPOSER = UNSUBMITTED_LINES.findIndex((line) => line.startsWith("› "));
const IDLE_LINES = REAL_IDLE_EMPTY_0163.trimEnd().split("\n");

/**
 * DERIVED: REAL_UNSUBMITTED_PASTE_0163 during a running turn. RUNNING_ROW_0163
 * and a blank line go directly above the composer, and the footer starts with
 * "tab to queue message", which Codex shows only during a turn (ao-communicate,
 * nex-2087, 2026-09-16: "`◦ Working (…)` above the composer and the hint
 * `tab to queue message` below it").
 */
export const DERIVED_MID_TURN_PASTE_0163 = [
  ...UNSUBMITTED_LINES.slice(0, UNSUBMITTED_COMPOSER),
  RUNNING_ROW_0163,
  "",
  ...UNSUBMITTED_LINES.slice(UNSUBMITTED_COMPOSER).map((line) =>
    line.includes("⚠ 2 warnings") ? "  tab to queue message" + line.slice(22) : line,
  ),
].join("\n");

/**
 * DERIVED: the screen after Codex took the notice of REAL_UNSUBMITTED_PASTE_0163.
 * The notice moves into the transcript, RUNNING_ROW_0163 shows below it, and the
 * composer and footer are the last four lines of REAL_IDLE_EMPTY_0163.
 */
export const DERIVED_SUBMITTED_RUNNING_0163 = [
  ...UNSUBMITTED_LINES.slice(0, UNSUBMITTED_COMPOSER + 3),
  "",
  RUNNING_ROW_0163,
  "",
  ...IDLE_LINES.slice(-4),
  "",
].join("\n");

/*
 * REVIEW screens: quoted verbatim from review r1 of the round-1 change
 * (development/reviews/codex_send_idle_review_r1_astra6.md, ao-56). The
 * reviewer constructed them; they are not captures.
 */

/**
 * REVIEW B-2: a running turn whose composer quotes a transcript. The prompt
 * row in column 0 is the composer; the two indented rows below it are message
 * text, one of them an indented prompt row.
 */
export const REVIEW_B2_NESTED_PROMPT =
  "◦ Working (5m 47s • esc to interrupt)\n› examine this transcript\n  Worked for 1s\n  › examine this transcript\n  tab to queue message\n";

/** REVIEW M-1 B, check 1: the first row of the message in the composer. */
export const REVIEW_M1B_FIRST_ROW = "› Describe";

/**
 * REVIEW M-1 B, check 2: the message `Describe this UI\n? for shortcuts means
 * help` in the composer. Its second row holds the footer text of an empty
 * composer, but that row is message text, not the footer.
 */
export const REVIEW_M1B_COMPOSER =
  "› Describe this UI\n  ? for shortcuts means help\n  Context 68% used\n  ⚠ 2 warnings · f2 to view";

/** REVIEW M-2: an idle composer whose text starts with "1. "; no selection list is on the screen. */
export const REVIEW_M2_NUMBERED_MESSAGE =
  "  Worked for 1s\n› 1. Summarize the test failures\n  Context 68% used\n  ⚠ 2 warnings · f2 to view\n";

/** REVIEW B-1: a draft of another sender, "Your", in an idle composer. */
export const REVIEW_B1_FOREIGN_DRAFT =
  "  Worked for 15m 54s • 12:24 PM\n\n› Your\n\n  Context 68% used\n  ⚠ 2 warnings · f2 to view\n";

/** REVIEW B-1: a paste of another sender, shown as a placeholder, in an idle composer. */
export const REVIEW_B1_FOREIGN_PASTE =
  "  Worked for 15m 54s • 12:24 PM\n\n› [Pasted Content 900 chars]\n\n  Context 68% used\n  ⚠ 2 warnings · f2 to view\n";
