/**
 * Codex TUI screen reader (0.163.0)
 *
 * Reads the bottom of a Codex screen: the composer, and the status row of a
 * running turn above it. The `detectActivity` of this plugin and the verify
 * loop of `ao send` both read a screen with this one parser, so they cannot
 * select different rows.
 *
 * The layout, from the bottom up: the footer row ("? for shortcuts" only
 * while the composer is empty, "tab to queue message" only during a turn),
 * the status line, a blank row, the composer, and during a turn the status
 * row ("◦ Working (5m 47s • esc to interrupt)") directly above the composer.
 * The composer starts with the prompt glyph in column 0. Codex indents its
 * wrapped rows and its further lines by 2 columns, so an indented "›" row is
 * message text (for example a quoted transcript), never the composer.
 */

/** The prompt row of the composer: the prompt glyph in column 0. */
const PROMPT_ROW = /^[›❯](?:\s|$)/;

/** The cursor row of a selection list ("› 1. Yes, proceed (y)"). */
const NUMBERED_PROMPT_ROW = /^[›❯]\s+\d+\.\s/;

/** An option row of a selection list ("  2. No, and tell Codex what to do differently"). */
const OPTION_ROW = /^\s+\d+\.\s/;

/** The key hint at the end of an option row ("(y)", "(esc)"). */
const KEY_HINT = /\((?:[a-z]|esc|enter|tab)\)\s*$/i;

/**
 * An option label of an approval view. The 0.163.0 binary holds "Yes, proceed",
 * "No, and tell Codex what to do differently", "No, continue without running
 * it" and more labels that start with "Yes," or "No,".
 */
const APPROVAL_LABEL = /^(?:[›❯]|\s)\s*\d+\.\s+(?:Yes|No),/;

/**
 * The hint row below a selection list. The 0.163.0 binary holds "Press … to
 * confirm or … to go back" and "Press a number to choose · esc to dismiss".
 */
const LIST_HINT = /\bpress (?:enter|a number)\b|\besc to (?:cancel|go back|dismiss)\b/i;

/**
 * The status row of a running turn: a bullet in column 0, the header, and the
 * elapsed time with "esc to interrupt" in parentheses
 * ("◦ Working (5m 47s • esc to interrupt)", "• Working (8s • esc to interrupt)").
 */
const STATUS_ROW = /^[•◦] \S.*\([^()]*\besc to interrupt\)/i;

/** The placeholder text of an empty composer. */
const PLACEHOLDER = "Ask Codex to do anything";

/** The footer hint that Codex shows only while the composer is empty. */
const EMPTY_HINT = /^\s*\?\s+for shortcuts\b/i;

/** A bare prompt on the last line (older Codex forms and shell prompts). */
const BARE_PROMPT = /^[>$#›❯]\s*$/;

/** What the composer holds: nothing, or text whose first row is `firstLine`. */
export type CodexComposer = { empty: true } | { empty: false; firstLine: string };

/** The parts of a Codex screen that tell whether a turn runs and where a message is. */
export interface CodexScreen {
  /** The composer, or null when none is in view (a selection list, or transcript rows below the last prompt row). */
  composer: CodexComposer | null;
  /**
   * True only when the status row of a running turn is directly above the
   * composer. Words in the composer text or in transcript rows never make it
   * true, and with no composer in view it is false.
   */
  runningTurn: boolean;
}

/**
 * The index of the composer's prompt row, or null. The scan goes up from the
 * last row over indented and blank rows (the composer text, the status line
 * and the footer). A row in column 0 that is not a prompt row is transcript,
 * so no composer is in view, and the cursor row of a selection list is not a
 * composer either.
 */
function findPromptRow(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (PROMPT_ROW.test(line)) return isSelectionCursor(lines, i) ? null : i;
    if (/^\S/.test(line)) return null;
  }
  return null;
}

/**
 * True when the prompt row at `index` is the cursor of a selection list (an
 * approval or picker view). The numbered prompt row and the numbered option
 * rows directly above and below it make the list. A composer whose text is a
 * numbered list has the same rows, so the list must also show a sign of a
 * menu: a key hint at the end of a list row, an approval label ("Yes, ...",
 * "No, ...") in a list row, or a hint row below the list.
 */
function isSelectionCursor(lines: string[], index: number): boolean {
  if (!NUMBERED_PROMPT_ROW.test(lines[index] ?? "")) return false;
  let first = index;
  while (OPTION_ROW.test(lines[first - 1] ?? "")) first--;
  let last = index;
  while (OPTION_ROW.test(lines[last + 1] ?? "")) last++;
  if (first === index && last === index) return false;
  const list = lines.slice(first, last + 1);
  if (list.some((line) => KEY_HINT.test(line) || APPROVAL_LABEL.test(line))) return true;
  return lines.slice(last + 1).some((line) => LIST_HINT.test(line));
}

/**
 * The composer at the prompt row `prompt`. It is empty when the prompt row
 * holds nothing or the placeholder, or when the footer shows "? for
 * shortcuts". The footer is the last row, and the hint counts only when a
 * blank row follows a one-row composer (prompt row, blank row, status line,
 * footer): a row of message text that starts with "? for shortcuts" is not
 * the footer.
 */
function readComposer(lines: string[], prompt: number): CodexComposer {
  const firstLine = (lines[prompt] ?? "").replace(/^[›❯]\s*/, "").trim();
  if (firstLine === "" || firstLine === PLACEHOLDER) return { empty: true };
  const last = lines.length - 1;
  const blankBelowPrompt = prompt + 1 < last && (lines[prompt + 1] ?? "").trim() === "";
  if (blankBelowPrompt && EMPTY_HINT.test(lines[last] ?? "")) return { empty: true };
  return { empty: false, firstLine };
}

/**
 * True when the status row of a running turn is directly above the prompt
 * row, with at most one blank row between them. No other row counts: the
 * words of the composer text and of the transcript ("Working tree clean.",
 * "Running tests failed") are never a running turn.
 */
function hasStatusRowAbove(lines: string[], prompt: number): boolean {
  const above = (lines[prompt - 1] ?? "").trim() === "" ? prompt - 2 : prompt - 1;
  return STATUS_ROW.test(lines[above] ?? "");
}

/**
 * Read a Codex screen (the text of `tmux capture-pane -p`). With no composer
 * in view, the screen shows no running turn that this parser can confirm. A
 * bare prompt on the last line is no running turn either, the same as the
 * bare-prompt rule of `detectActivity`.
 */
export function readCodexScreen(terminalOutput: string): CodexScreen {
  const lines = terminalOutput.trimEnd().split("\n");
  const prompt = findPromptRow(lines);
  if (prompt === null) return { composer: null, runningTurn: false };
  const barePrompt = BARE_PROMPT.test((lines[lines.length - 1] ?? "").trim());
  return {
    composer: readComposer(lines, prompt),
    runningTurn: !barePrompt && hasStatusRowAbove(lines, prompt),
  };
}
