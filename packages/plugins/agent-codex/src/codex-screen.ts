/**
 * Codex TUI screen reader (0.163.0)
 *
 * Reads the bottom of a Codex screen: the composer, and the running-turn row
 * above it. The `detectActivity` of this plugin and the verify loop of
 * `ao send` both read a screen with this one parser, so they cannot select
 * different rows.
 *
 * The layout, from the bottom up: the footer row ("? for shortcuts" only
 * while the composer is empty, "tab to queue message" only during a turn),
 * the status line, a blank row, the composer, and during a turn the
 * running-turn row ("◦ Working (5m 47s • esc to interrupt)") with a blank row
 * below it. The composer starts with the prompt glyph in column 0. Codex
 * indents its wrapped rows and its further lines by 2 columns, so an indented
 * "›" row is message text (for example a quoted transcript), never the
 * composer.
 */

/** The prompt row of the composer: the prompt glyph in column 0. */
const PROMPT_ROW = /^[›❯](?:\s|$)/;

/** A prompt glyph after indentation: a row of the composer text, such as a quoted transcript. */
const INDENTED_PROMPT_ROW = /^\s+[›❯](?:\s|$)/;

/** The cursor row of a selection list ("› 1. Yes, proceed (y)"). */
const NUMBERED_PROMPT_ROW = /^[›❯]\s+\d+\.\s/;

/** An option row of a selection list ("  2. No, and tell Codex what to do differently"). */
const OPTION_ROW = /^\s+\d+\.\s/;

/** The row that closes a finished turn ("Worked for 15m 54s • 12:24 PM"). */
const TURN_END_ROW = /^[\s─]*Worked for \d+[hms]\b/;

/** The running-turn row ("◦ Working (5m 47s • esc to interrupt)") and older active words. */
const RUNNING_PATTERNS = [/\b(Working|Thinking|Running|Osmosing)\b/i, /esc to interrupt/i];

/**
 * How many rows above the composer can hold the running-turn row. Codex draws
 * that row directly above the composer; "Working" text further up is
 * scrollback and must not make an idle screen active.
 */
const TURN_ROW_WINDOW = 8;

/** How many rows at the bottom the older rules read when no composer is in view. */
const TAIL_ROWS = 8;

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
  /** True when the screen shows a running turn. */
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
 * approval or picker view): a numbered row with a numbered option row directly
 * above or below it. A composer whose text starts with "1. " has no such row
 * next to it.
 */
function isSelectionCursor(lines: string[], index: number): boolean {
  if (!NUMBERED_PROMPT_ROW.test(lines[index] ?? "")) return false;
  return OPTION_ROW.test(lines[index - 1] ?? "") || OPTION_ROW.test(lines[index + 1] ?? "");
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

function hasRunningWords(line: string): boolean {
  return RUNNING_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * True when the rows above the composer show a running turn. The scan covers
 * TURN_ROW_WINDOW rows above the prompt row and stops at the "Worked for" row
 * of a finished turn: the text above that row is the transcript of that turn.
 * The rows of the composer text are never read.
 *
 * When the composer text holds rows that look like screen rows (an indented
 * prompt row or a "Worked for" row, as in a quoted transcript), the layout
 * leaves a doubt. Then the running-turn row or a running word in the window
 * counts also above a "Worked for" row: a running turn wins.
 */
function hasRunningTurnAbove(lines: string[], prompt: number): boolean {
  const doubt = lines
    .slice(prompt + 1)
    .some((line) => INDENTED_PROMPT_ROW.test(line) || TURN_END_ROW.test(line));
  const stop = Math.max(0, prompt - TURN_ROW_WINDOW);
  for (let i = prompt - 1; i >= stop; i--) {
    const line = lines[i] ?? "";
    if (!doubt && TURN_END_ROW.test(line)) return false;
    if (hasRunningWords(line)) return true;
  }
  return false;
}

/**
 * Read a Codex screen (the text of `tmux capture-pane -p`). With no composer
 * in view, a running word or "esc to interrupt" in the last TAIL_ROWS rows is
 * a running turn, as in the older rules. A bare prompt on the last line is no
 * running turn: it overrides "Working" text left in the scrollback.
 */
export function readCodexScreen(terminalOutput: string): CodexScreen {
  const lines = terminalOutput.trimEnd().split("\n");
  const barePrompt = BARE_PROMPT.test((lines[lines.length - 1] ?? "").trim());
  const prompt = findPromptRow(lines);
  if (prompt === null) {
    return {
      composer: null,
      runningTurn: !barePrompt && lines.slice(-TAIL_ROWS).some(hasRunningWords),
    };
  }
  return {
    composer: readComposer(lines, prompt),
    runningTurn: !barePrompt && hasRunningTurnAbove(lines, prompt),
  };
}
