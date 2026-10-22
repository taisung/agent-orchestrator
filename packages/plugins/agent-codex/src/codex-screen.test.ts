import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { readCodexScreen } from "./codex-screen.js";
import RUNNING_01 from "./__fixtures__/codex-0.163.0-running-01.txt?raw";
import RUNNING_02 from "./__fixtures__/codex-0.163.0-running-02.txt?raw";
import RUNNING_03 from "./__fixtures__/codex-0.163.0-running-03.txt?raw";
import RUNNING_04 from "./__fixtures__/codex-0.163.0-running-04.txt?raw";
import RUNNING_05 from "./__fixtures__/codex-0.163.0-running-05.txt?raw";
import RUNNING_06 from "./__fixtures__/codex-0.163.0-running-06.txt?raw";
import {
  DERIVED_MID_TURN_PASTE_0163,
  DERIVED_SUBMITTED_RUNNING_0163,
  REAL_IDLE_EMPTY_0163,
  REAL_UNSUBMITTED_PASTE_0163,
  REVIEW_B1_FOREIGN_PASTE,
  REVIEW_B2_NESTED_PROMPT,
  REVIEW_M1B_COMPOSER,
  REVIEW_M2_NUMBERED_MESSAGE,
  REVIEW_R2_M1_QUOTED_PROMPT,
  REVIEW_R2_M2_NUMBERED_LIST,
  REVIEW_R2_M3_APPROVAL,
  RUNNING_ROW_0163,
} from "./__fixtures__/panes-0.163.0.js";

/** The six real captures of a running turn, by number (see `__fixtures__/panes-0.163.0.ts`). */
const REAL_RUNNING: Record<string, string> = {
  "01": RUNNING_01,
  "02": RUNNING_02,
  "03": RUNNING_03,
  "04": RUNNING_04,
  "05": RUNNING_05,
  "06": RUNNING_06,
};

/** The first row of capture `n` that starts with `prefix`. */
function rowOf(n: string, prefix: string): string {
  const row = (REAL_RUNNING[n] ?? "").split("\n").find((line) => line.startsWith(prefix));
  if (row === undefined) throw new Error(`capture ${n} has no row that starts with ${prefix}`);
  return row;
}

/** The status row, the Tip row and the command row of the real captures. */
const STATUS_01 = rowOf("01", "• Working (3s");
const STATUS_04 = rowOf("04", "• Working (3m 14s");
const TIP_ROW = rowOf("02", "  └ Tip:");
const COMMAND_ROW = rowOf("05", "  └ env -i");

/** The composer, the status line and the footer of capture 01 (its last 4 rows). */
const COMPOSER_ROWS = RUNNING_01.trimEnd().split("\n").slice(-4);

/** A transcript row, the `above` rows, then COMPOSER_ROWS. */
function screen(...above: string[]): string {
  return ["  transcript line", ...above, ...COMPOSER_ROWS].join("\n");
}

describe("readCodexScreen on Codex 0.163.0 screens", () => {
  it("keeps the six real running captures byte for byte (the SHA-256 of the orchestrator's files)", () => {
    const sums = Object.fromEntries(
      Object.entries(REAL_RUNNING).map(([n, capture]) => [
        n,
        createHash("sha256").update(capture, "utf8").digest("hex").slice(0, 8),
      ]),
    );
    expect(sums).toEqual({
      "01": "163a64fd",
      "02": "773f637c",
      "03": "a0ab7ca8",
      "04": "10b1b6f3",
      "05": "172ac0e0",
      "06": "613096c7",
    });
  });

  it.each(Object.entries(REAL_RUNNING))(
    "reads real running capture %s: an empty composer below the status block, a running turn",
    (_n, capture) => {
      expect(readCodexScreen(capture)).toEqual({ composer: { empty: true }, runningTurn: true });
    },
  );

  it("reads the real idle screen: an empty composer and no running turn", () => {
    expect(readCodexScreen(REAL_IDLE_EMPTY_0163)).toEqual({
      composer: { empty: true },
      runningTurn: false,
    });
  });

  it("reads the real unsubmitted screen: the first row of the paste and no running turn", () => {
    expect(readCodexScreen(REAL_UNSUBMITTED_PASTE_0163)).toEqual({
      composer: {
        empty: false,
        firstLine:
          "Your .agent_task.md is replaced with the round-2 brief: re-check the same-ID design revision r2",
      },
      runningTurn: false,
    });
  });

  it("reads the running-turn row above a composer with text and above an empty composer", () => {
    expect(readCodexScreen(DERIVED_MID_TURN_PASTE_0163)).toMatchObject({
      composer: { empty: false },
      runningTurn: true,
    });
    expect(readCodexScreen(DERIVED_SUBMITTED_RUNNING_0163)).toEqual({
      composer: { empty: true },
      runningTurn: true,
    });
  });

  it("B-2: the prompt row in column 0 is the composer, an indented prompt row is message text", () => {
    expect(readCodexScreen(REVIEW_B2_NESTED_PROMPT)).toEqual({
      composer: { empty: false, firstLine: "examine this transcript" },
      runningTurn: true,
    });
  });

  it("M-1: a message row that starts with '? for shortcuts' is not the footer", () => {
    expect(readCodexScreen(REVIEW_M1B_COMPOSER)).toEqual({
      composer: { empty: false, firstLine: "Describe this UI" },
      runningTurn: false,
    });

    // The same message in the real layout: blank row, status line, footer.
    const real = [
      "› Describe this UI",
      "  ? for shortcuts means help",
      ...REAL_UNSUBMITTED_PASTE_0163.trimEnd().split("\n").slice(-3),
    ].join("\n");
    expect(readCodexScreen(real).composer).toEqual({ empty: false, firstLine: "Describe this UI" });
  });

  it("reads '? for shortcuts' in the footer below a one-row composer as empty, whatever the placeholder", () => {
    const otherPlaceholder = REAL_IDLE_EMPTY_0163.replace(
      "› Ask Codex to do anything",
      "› Explain this codebase",
    );
    expect(otherPlaceholder).not.toBe(REAL_IDLE_EMPTY_0163);
    expect(readCodexScreen(otherPlaceholder).composer).toEqual({ empty: true });
  });

  it("M-2: a composer whose text starts with '1. ' is a composer; a selection list is not", () => {
    expect(readCodexScreen(REVIEW_M2_NUMBERED_MESSAGE)).toEqual({
      composer: { empty: false, firstLine: "1. Summarize the test failures" },
      runningTurn: false,
    });

    const selection =
      "  $ pnpm test\n\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)\n";
    expect(readCodexScreen(selection)).toEqual({ composer: null, runningTurn: false });
  });

  it("review r2 M-2: a two-item numbered message is a composer, and its word 'Running' is no running turn", () => {
    expect(readCodexScreen(REVIEW_R2_M2_NUMBERED_LIST)).toEqual({
      composer: { empty: false, firstLine: "1. Inspect the failure" },
      runningTurn: false,
    });
  });

  it("reads a numbered list as a selection list only with a key hint, an approval label or a hint row below it", () => {
    // Derived: the hint rows are strings of the 0.163.0 binary ("Press … to
    // confirm or … to go back", "Press a number to choose · esc to dismiss").
    const picker = [
      "  Select a model",
      "",
      "› 1. gpt-6-astra (current)",
      "  2. gpt-6.1-sol",
      "",
      "  Press enter to confirm or esc to go back",
    ].join("\n");
    expect(readCodexScreen(picker)).toEqual({ composer: null, runningTurn: false });
    const numberPicker = picker.replace(
      "Press enter to confirm or esc to go back",
      "Press a number to choose · esc to dismiss · type to continue",
    );
    expect(numberPicker).not.toBe(picker);
    expect(readCodexScreen(numberPicker).composer).toBeNull();

    // Derived: an approval view with no key hint and no hint row. Its labels
    // are strings of the 0.163.0 binary.
    const approval = [
      "  Would you like to run the following command?",
      "",
      "  $ pnpm test",
      "",
      "› 1. Yes, proceed",
      "  2. Yes, and don't ask again for this command in this session",
      "  3. No, and tell Codex what to do differently",
    ].join("\n");
    expect(readCodexScreen(approval)).toEqual({ composer: null, runningTurn: false });
    const cursorOnNo = approval
      .replace("› 1. Yes, proceed", "  1. Yes, proceed")
      .replace("  3. No, and tell", "› 3. No, and tell");
    expect(cursorOnNo).not.toBe(approval);
    expect(readCodexScreen(cursorOnNo).composer).toBeNull();

    // Control: the same two numbered rows with the composer's status line and
    // footer below them are a composer.
    const message = [
      "› 1. gpt-6-astra (current)",
      "  2. gpt-6.1-sol",
      "",
      "  Context 68% used",
      "  ⚠ 2 warnings · f2 to view",
    ].join("\n");
    expect(readCodexScreen(message).composer).toEqual({
      empty: false,
      firstLine: "1. gpt-6-astra (current)",
    });
  });

  it("reads a paste placeholder as composer text", () => {
    expect(readCodexScreen(REVIEW_B1_FOREIGN_PASTE).composer).toEqual({
      empty: false,
      firstLine: "[Pasted Content 900 chars]",
    });
  });

  it("finds no composer when a row in column 0 is below the last prompt row", () => {
    expect(readCodexScreen("› old message\n• Ran pnpm test\n  └ ok\n")).toEqual({
      composer: null,
      runningTurn: false,
    });
    // A running word or the status row with no composer below it is no
    // running turn that the parser can confirm.
    expect(readCodexScreen(`› old message\n${RUNNING_ROW_0163}\n  still going`)).toEqual({
      composer: null,
      runningTurn: false,
    });
  });

  it("review r2 M-3: an approval prompt below 'Working' prose is no running turn", () => {
    expect(readCodexScreen(REVIEW_R2_M3_APPROVAL)).toEqual({ composer: null, runningTurn: false });
  });

  it("review r2 M-1: a quoted prompt row does not make the rows of a finished turn a running turn", () => {
    expect(readCodexScreen(REVIEW_R2_M1_QUOTED_PROMPT)).toEqual({
      composer: { empty: false, firstLine: "examine this transcript" },
      runningTurn: false,
    });
  });

  it("reads a running turn from the status block: the status row, up to two └ rows, up to two blank rows", () => {
    // The layouts of the real captures: 01 (no └ row), 02 03 06 (the Tip
    // row), 04 (text after the ")"), 05 (a command row and the Tip row).
    expect(readCodexScreen(screen(STATUS_01, "", "")).runningTurn).toBe(true);
    expect(readCodexScreen(screen(STATUS_01, TIP_ROW, "", "")).runningTurn).toBe(true);
    expect(readCodexScreen(screen(STATUS_04, TIP_ROW, "", "")).runningTurn).toBe(true);
    expect(readCodexScreen(screen(STATUS_01, COMMAND_ROW, TIP_ROW, "", "")).runningTurn).toBe(true);
    // Fewer blank rows: the derived screens and the B-2 screen of the reviews.
    expect(readCodexScreen(screen(RUNNING_ROW_0163)).runningTurn).toBe(true);
    expect(readCodexScreen(screen(RUNNING_ROW_0163, "")).runningTurn).toBe(true);
    expect(readCodexScreen(screen(STATUS_01, TIP_ROW)).runningTurn).toBe(true);
  });

  it("reads no running turn past the bounds of the status block", () => {
    // Three blank rows, three └ rows, a blank row above a └ row.
    expect(readCodexScreen(screen(STATUS_01, "", "", "")).runningTurn).toBe(false);
    expect(
      readCodexScreen(screen(STATUS_01, COMMAND_ROW, COMMAND_ROW, TIP_ROW, "", "")).runningTurn,
    ).toBe(false);
    expect(readCodexScreen(screen(STATUS_01, "", TIP_ROW, "", "")).runningTurn).toBe(false);
  });

  it("reads no running turn when a row of another kind is between the status row and the composer", () => {
    // Derived from capture 02: one row that is not a └ row and not blank.
    for (const other of [
      "    + Show details",
      "  Worked for 1s",
      "  transcript line",
      "• Ran pnpm test",
      "  └",
    ]) {
      expect(readCodexScreen(screen(STATUS_01, TIP_ROW, other, "", "")).runningTurn).toBe(false);
      expect(readCodexScreen(screen(STATUS_01, other, "", "")).runningTurn).toBe(false);
    }
  });

  it("reads no running turn for a status-row text in a transcript row above a 'Worked for' row or a text row", () => {
    // Derived: the real idle layout ("Worked for", two blank rows, composer)
    // below a status-shaped transcript row, with and without a Tip row.
    expect(readCodexScreen(screen(STATUS_01, "  Worked for 1s", "", "")).runningTurn).toBe(false);
    expect(readCodexScreen(screen(STATUS_01, TIP_ROW, "  Worked for 1s", "", "")).runningTurn).toBe(
      false,
    );
    expect(readCodexScreen(screen(STATUS_01, "  Working tree clean.", "", "")).runningTurn).toBe(
      false,
    );
    expect(readCodexScreen(screen(STATUS_01, "• Ran pnpm test", "", "")).runningTurn).toBe(false);
  });

  it("reads no running turn for a status-row text inside the composer", () => {
    // The real bottom of a composer with text (REAL_UNSUBMITTED_PASTE_0163):
    // a blank row, the status line and the warnings row, no "? for shortcuts".
    const footer = REAL_UNSUBMITTED_PASTE_0163.trimEnd().split("\n").slice(-3);
    const above = ["  Worked for 1s", "", ""];

    // The status row as the first row of the message.
    expect(readCodexScreen([...above, `› ${STATUS_01}`, ...footer].join("\n"))).toEqual({
      composer: { empty: false, firstLine: STATUS_01 },
      runningTurn: false,
    });

    // A whole status block quoted in the further rows of the message, which
    // Codex indents by 2 columns.
    const quoted = [
      ...above,
      "› why does the pane show this block",
      `  ${STATUS_01}`,
      `  ${TIP_ROW}`,
      ...footer,
    ].join("\n");
    expect(readCodexScreen(quoted)).toEqual({
      composer: { empty: false, firstLine: "why does the pane show this block" },
      runningTurn: false,
    });
  });

  it("reads no running turn from running words or 'esc to interrupt' outside the status row form", () => {
    expect(
      readCodexScreen(screen("  Working (5m 47s • esc to interrupt)", "", "")).runningTurn,
    ).toBe(false);
    expect(readCodexScreen(screen("• Running the suite again", "", "")).runningTurn).toBe(false);
    expect(readCodexScreen(screen("Working on task (esc to interrupt)")).runningTurn).toBe(false);
  });

  it("reads no running turn when a bare prompt is on the last line", () => {
    expect(readCodexScreen(`${RUNNING_ROW_0163}\n›`)).toEqual({
      composer: { empty: true },
      runningTurn: false,
    });
    expect(readCodexScreen("Working on task (esc to interrupt)\nFinished.\n$ ").runningTurn).toBe(
      false,
    );
  });
});
