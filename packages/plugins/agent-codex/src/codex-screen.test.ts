import { describe, it, expect } from "vitest";
import { readCodexScreen } from "./codex-screen.js";
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

describe("readCodexScreen on Codex 0.163.0 screens", () => {
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

  it("reads a numbered list as a selection list only with a key hint or a hint row below it", () => {
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

  it("reads a running turn only from the status row directly above the composer", () => {
    const bottom = REAL_IDLE_EMPTY_0163.trimEnd().split("\n").slice(-4);
    const screen = (...above: string[]): string =>
      ["  transcript line", ...above, ...bottom].join("\n");

    expect(readCodexScreen(screen(RUNNING_ROW_0163)).runningTurn).toBe(true);
    expect(readCodexScreen(screen(RUNNING_ROW_0163, "")).runningTurn).toBe(true);
    expect(readCodexScreen(screen("• Working (8s • esc to interrupt)", "")).runningTurn).toBe(true);

    // A row between the status row and the composer, or two blank rows.
    expect(readCodexScreen(screen(RUNNING_ROW_0163, "  transcript line")).runningTurn).toBe(false);
    expect(readCodexScreen(screen(RUNNING_ROW_0163, "", "")).runningTurn).toBe(false);
    // Running words and "esc to interrupt" outside the status row form.
    expect(readCodexScreen(screen("  Working (5m 47s • esc to interrupt)")).runningTurn).toBe(
      false,
    );
    expect(readCodexScreen(screen("• Running the suite again")).runningTurn).toBe(false);
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
