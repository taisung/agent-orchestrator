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
    expect(readCodexScreen(`› old message\n${RUNNING_ROW_0163}\n  still going`)).toEqual({
      composer: null,
      runningTurn: true,
    });
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
