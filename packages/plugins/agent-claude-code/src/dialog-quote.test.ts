import { describe, it, expect } from "vitest";
import { create } from "./index.js";
import IDLE_BYPASS_307 from "./__fixtures__/claude-2.1.307-idle-bypass.txt?raw";
import DIALOG_T1_304 from "./__fixtures__/claude-2.1.304-dialog-t1-01_before.txt?raw";
import DIALOG_T3_304 from "./__fixtures__/claude-2.1.304-dialog-t3-00b_after_down.txt?raw";
import DIALOG_T4_304 from "./__fixtures__/claude-2.1.304-dialog-t4-00c_typed_text.txt?raw";
import DIALOG_T5_OPEN_304 from "./__fixtures__/claude-2.1.304-dialog-t5-00_dialog_open.txt?raw";
import DIALOG_T5_PASTE1_304 from "./__fixtures__/claude-2.1.304-dialog-t5-paste1-03_verify1.txt?raw";
import DIALOG_T5_PASTE3_304 from "./__fixtures__/claude-2.1.304-dialog-t5-paste3-03_verify1.txt?raw";

// m-1 (review r1 of the claude-code detectActivity round): with no input box
// in view, a numbered list that a message or a user turn quotes must read as
// the same screen without the list, and every real dialog must stay
// `waiting_input`. A real dialog has its top rule row above the cursor and no
// transcript entry (`●`, or `❯` for a user turn) between them; a quote has
// no rule row above it, or its entry row lies between.

const agent = create();
const RULE = "─".repeat(98);

/** IDLE_BYPASS_307 with the input box, the status line and the footer replaced by `rows`. */
function noBox(rows: string[]): string {
  const all = IDLE_BYPASS_307.replace(/\n$/, "").split("\n");
  expect(all.slice(-4, -3)).toEqual(["❯ "]);
  return [...all.slice(0, -5), ...rows].join("\n") + "\n";
}

describe("detectActivity: a quoted numbered list is no dialog (m-1)", () => {
  it("reads the reproducer of review r1 as the same rows without the list", () => {
    const quote = "● Here is an example:\n  ❯ 1. Red\n    2. Blue\n";
    expect(agent.detectActivity("● Here is an example:\n")).toBe("active");
    expect(agent.detectActivity(quote)).toBe("active");
  });

  it("reads a quote whose message starts above the top of the screen as the rows without the list", () => {
    // The `●` row of the message is above the captured rows: only the missing
    // rule row tells the quote from a dialog.
    const text = "  The reply goes on, and its first row is above the screen:\n";
    expect(agent.detectActivity(text)).toBe("active");
    expect(agent.detectActivity(`${text}  ❯ 1. Red\n    2. Blue\n`)).toBe("active");
  });

  it.each([
    ["a message quotes a list", ["● Here is an example:"], ["  ❯ 1. Red", "    2. Blue"]],
    [
      "a message quotes a question and its list",
      ["● The pane asked:", "", "  Which color do you pick?", ""],
      ["  ❯ 1. Red", "     the first option", "    2. Blue", "    3. Type something."],
    ],
    ["a user turn quotes a list", ["❯ Pick one of these:"], ["  ❯ 1. Red", "    2. Blue"]],
    [
      "a message below a rule row quotes a list",
      [RULE, "● Here is an example:"],
      ["  ❯ 1. Red", "    2. Blue"],
    ],
    [
      "a user turn below a rule row quotes a list",
      [RULE, "❯ Pick one of these:"],
      ["  ❯ 1. Red", "    2. Blue"],
    ],
  ])(
    "reads a screen with no input box where %s as the screen without the list",
    (_, entry, list) => {
      const without = noBox(entry);
      const withList = noBox([...entry, ...list]);
      expect(agent.detectActivity(without)).toBe("active");
      expect(agent.detectActivity(withList)).toBe(agent.detectActivity(without));
    },
  );

  it("control: reads the quote above the live input box as idle", () => {
    const all = IDLE_BYPASS_307.replace(/\n$/, "").split("\n");
    const done = all.indexOf("✻ Brewed for 4s · done 10:41 PM");
    expect(done).toBeGreaterThan(0);
    const screen = [
      ...all.slice(0, done),
      "● Here is an example:",
      "  ❯ 1. Red",
      "    2. Blue",
      "",
      ...all.slice(done),
    ].join("\n");
    expect(agent.detectActivity(screen)).toBe("idle");
  });

  it.each([
    ["t1", DIALOG_T1_304],
    ["t3 after Down", DIALOG_T3_304],
    ["t4 typed text", DIALOG_T4_304],
    ["t5 open", DIALOG_T5_OPEN_304],
    ["t5 second question", DIALOG_T5_PASTE1_304],
    ["t5 review screen", DIALOG_T5_PASTE3_304],
  ])("control: keeps the real 2.1.304 dialog %s waiting_input", (_, screen) => {
    expect(agent.detectActivity(screen)).toBe("waiting_input");
  });

  it("control: keeps a real dialog waiting_input with a quoted list in the transcript above it", () => {
    const all = DIALOG_T1_304.replace(/\n$/, "").split("\n");
    const turn = all.findIndex((row) => row.startsWith("❯ Call the AskUserQuestion tool"));
    expect(turn).toBeGreaterThan(0);
    const screen = [
      ...all.slice(0, turn),
      "● Here is an example:",
      "  ❯ 1. Red",
      "    2. Blue",
      "",
      ...all.slice(turn),
    ].join("\n");
    expect(agent.detectActivity(screen)).toBe("waiting_input");
  });
});
