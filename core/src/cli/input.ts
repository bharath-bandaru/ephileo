/**
 * Multi-line raw-mode input handler for the Ephileo REPL.
 *
 * Supports:
 * - Cursor movement with arrow keys (left/right within line, up/down across lines)
 * - Command history navigation with up/down on first/last line
 * - Shift+Enter or backslash-Enter for multi-line continuation
 * - Backspace at cursor position (joins lines when at column 0)
 * - Slash command autocomplete with arrow-key menu navigation
 */

import type { Readable, Writable } from "node:stream";
import {
  type AutocompleteState,
  type CompletionItem,
  clearMenu,
  createAutocomplete,
  getSelectedItem,
  moveSelection,
  renderMenu,
  updateFilter,
} from "./autocomplete.js";
import {
  type ArrowDirection,
  getArrowDirection,
  isBackspace,
  isCtrlC,
  isCtrlD,
  isEscape,
  isPlainEnter,
  isShiftEnter,
  isTab,
  isUnhandledEscape,
} from "./input-keys.js";
import {
  ANSI_MOVE_DOWN,
  ANSI_MOVE_UP,
  moveCursorToCol,
  redrawLine,
  visualLength,
} from "./input-rendering.js";

// --- Public types ----------------------------------------------------------

interface MultiLineInputOptions {
  /** Primary prompt string (e.g. "> "). */
  prompt: string;
  /** Continuation prompt for subsequent lines (e.g. ".. "). */
  continuationPrompt: string;
  /** Previously entered commands for history navigation. */
  history?: string[];
  /** Readable stream to read from (defaults to process.stdin). */
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  /** Writable stream to write to (defaults to process.stderr). */
  output?: Writable;
  /** Callback that returns available slash command completions. */
  completionProvider?: () => CompletionItem[];
}

type InputResult = { kind: "input"; value: string } | { kind: "eof" };

// --- Cursor state ----------------------------------------------------------

interface CursorState {
  lines: string[];
  row: number;
  col: number;
}

function currentPrompt(state: CursorState, promptStr: string, contPrompt: string): string {
  return state.row === 0 ? promptStr : contPrompt;
}

// --- Arrow key handlers ----------------------------------------------------

function handleArrowLeft(state: CursorState): void {
  if (state.col > 0) {
    state.col--;
  }
}

function handleArrowRight(state: CursorState): void {
  if (state.col < state.lines[state.row].length) {
    state.col++;
  }
}

/** Returns true if this was a cursor move (not a history navigation). */
function handleArrowUp(state: CursorState): boolean {
  if (state.row > 0) {
    state.row--;
    state.col = Math.min(state.col, state.lines[state.row].length);
    return true;
  }
  return false;
}

/** Returns true if this was a cursor move (not a history navigation). */
function handleArrowDown(state: CursorState): boolean {
  if (state.row < state.lines.length - 1) {
    state.row++;
    state.col = Math.min(state.col, state.lines[state.row].length);
    return true;
  }
  return false;
}

// --- History navigation ----------------------------------------------------

interface HistoryState {
  entries: string[];
  /** Index into entries. Equal to entries.length means "current draft". */
  index: number;
  /** Saved draft text when browsing history. */
  draft: string;
}

function historyUp(hState: HistoryState, cursor: CursorState): boolean {
  if (hState.entries.length === 0 || hState.index <= 0) return false;

  // Save draft on first navigation away from current input
  if (hState.index === hState.entries.length) {
    hState.draft = cursor.lines.join("\n");
  }

  hState.index--;
  const entry = hState.entries[hState.index];
  const newLines = entry.split("\n");
  cursor.lines = newLines;
  cursor.row = 0;
  cursor.col = newLines[0].length;
  return true;
}

function historyDown(hState: HistoryState, cursor: CursorState): boolean {
  if (hState.index >= hState.entries.length) return false;

  hState.index++;
  const text = hState.index === hState.entries.length ? hState.draft : hState.entries[hState.index];
  const newLines = text.split("\n");
  cursor.lines = newLines;
  cursor.row = newLines.length - 1;
  cursor.col = newLines[cursor.row].length;
  return true;
}

// --- Full redraw (all lines) -----------------------------------------------

function redrawAllLines(
  output: Writable,
  cursor: CursorState,
  promptStr: string,
  contPrompt: string,
): void {
  // Move up to first line
  for (let i = cursor.lines.length - 1; i > 0; i--) {
    output.write(ANSI_MOVE_UP);
  }
  // Redraw each line
  for (let i = 0; i < cursor.lines.length; i++) {
    const p = i === 0 ? promptStr : contPrompt;
    redrawLine(output, p, cursor.lines[i]);
    if (i < cursor.lines.length - 1) {
      output.write("\n");
    }
  }
  // Move cursor back to the active row
  for (let i = cursor.lines.length - 1; i > cursor.row; i--) {
    output.write(ANSI_MOVE_UP);
  }
  const p = currentPrompt(cursor, promptStr, contPrompt);
  moveCursorToCol(output, cursor.col, visualLength(p));
}

// --- Autocomplete helpers --------------------------------------------------

function shouldShowAutocomplete(cursor: CursorState): boolean {
  return cursor.lines.length === 1 && cursor.row === 0 && cursor.lines[0].startsWith("/");
}

function refreshAutocomplete(
  output: Writable,
  cursor: CursorState,
  acRef: { state: AutocompleteState | null },
  provider: () => CompletionItem[],
): void {
  const line = cursor.lines[cursor.row];
  if (shouldShowAutocomplete(cursor)) {
    const filter = line.slice(1);
    if (!acRef.state) {
      acRef.state = createAutocomplete(provider());
    }
    updateFilter(acRef.state, filter);
    if (acRef.state.filtered.length > 0) {
      renderMenu(output, acRef.state);
    } else {
      clearMenu(output, acRef.state);
      acRef.state = null;
    }
  } else if (acRef.state) {
    clearMenu(output, acRef.state);
    acRef.state = null;
  }
}

function dismissAutocomplete(output: Writable, acRef: { state: AutocompleteState | null }): void {
  if (acRef.state) {
    clearMenu(output, acRef.state);
    acRef.state = null;
  }
}

// --- Core input function ---------------------------------------------------

function readMultiLineInput(options: MultiLineInputOptions): Promise<InputResult> {
  const {
    prompt,
    continuationPrompt,
    history = [],
    input = process.stdin,
    output = process.stderr,
    completionProvider,
  } = options;

  return new Promise((resolve) => {
    const cursor: CursorState = { lines: [""], row: 0, col: 0 };
    const hState: HistoryState = {
      entries: history,
      index: history.length,
      draft: "",
    };
    const acRef: { state: AutocompleteState | null } = { state: null };

    // Show the initial prompt
    output.write(prompt);

    // Enter raw mode if available (TTY only)
    if (input.isTTY && input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();

    const cleanup = () => {
      dismissAutocomplete(output, acRef);
      input.removeListener("data", onData);
      if (input.isTTY && input.setRawMode) {
        input.setRawMode(false);
      }
      input.pause();
    };

    const onData = (data: Buffer) => {
      // --- Ctrl+C: exit immediately ---
      if (isCtrlC(data)) {
        cleanup();
        output.write("\n");
        process.exit(0);
      }

      // --- Ctrl+D: EOF on empty buffer ---
      if (isCtrlD(data)) {
        const fullInput = cursor.lines.join("\n");
        if (fullInput.length === 0) {
          cleanup();
          output.write("\n");
          resolve({ kind: "eof" });
          return;
        }
        return;
      }

      // --- Escape (standalone): dismiss autocomplete or ignore ---
      if (isEscape(data)) {
        dismissAutocomplete(output, acRef);
        return;
      }

      // --- Tab: fill autocomplete selection or ignore ---
      if (isTab(data)) {
        if (acRef.state) {
          const selected = getSelectedItem(acRef.state);
          if (selected) {
            const value = `/${selected.name}`;
            cursor.lines[cursor.row] = value;
            cursor.col = value.length;
            dismissAutocomplete(output, acRef);
            const p = currentPrompt(cursor, prompt, continuationPrompt);
            redrawLine(output, p, value);
            moveCursorToCol(output, cursor.col, visualLength(p));
          }
        }
        return; // always consume Tab
      }

      // --- Shift+Enter: insert newline continuation ---
      if (isShiftEnter(data)) {
        dismissAutocomplete(output, acRef);
        insertNewline(output, cursor, prompt, continuationPrompt);
        return;
      }

      // --- Plain Enter ---
      if (isPlainEnter(data)) {
        // Autocomplete selection: fill and submit
        if (acRef.state) {
          const selected = getSelectedItem(acRef.state);
          if (selected) {
            const value = `/${selected.name}`;
            cursor.lines = [value];
            cursor.col = value.length;
            dismissAutocomplete(output, acRef);
            const p = currentPrompt(cursor, prompt, continuationPrompt);
            redrawLine(output, p, value);
            cleanup();
            output.write("\n");
            resolve({ kind: "input", value });
            return;
          }
        }

        const line = cursor.lines[cursor.row];
        // Backslash at end of line → continuation
        if (line.endsWith("\\")) {
          cursor.lines[cursor.row] = line.slice(0, -1);
          const p = currentPrompt(cursor, prompt, continuationPrompt);
          redrawLine(output, p, cursor.lines[cursor.row]);
          insertNewline(output, cursor, prompt, continuationPrompt);
          return;
        }
        // Move cursor to end of last line for clean newline display
        if (cursor.row < cursor.lines.length - 1) {
          for (let i = cursor.row; i < cursor.lines.length - 1; i++) {
            output.write("\x1b[B"); // move down
          }
        }
        cleanup();
        output.write("\n");
        resolve({ kind: "input", value: cursor.lines.join("\n") });
        return;
      }

      // --- Arrow keys ---
      const arrow = getArrowDirection(data);
      if (arrow) {
        // Autocomplete navigation: intercept up/down for menu
        if (acRef.state && (arrow === "up" || arrow === "down")) {
          moveSelection(acRef.state, arrow);
          renderMenu(output, acRef.state);
          return;
        }
        handleArrow(arrow, output, cursor, hState, prompt, continuationPrompt);
        return;
      }

      // --- Backspace ---
      if (isBackspace(data)) {
        handleBackspace(output, cursor, prompt, continuationPrompt);
        if (completionProvider) {
          refreshAutocomplete(output, cursor, acRef, completionProvider);
        }
        return;
      }

      // --- Ignore unrecognized escape sequences ---
      if (isUnhandledEscape(data)) {
        return;
      }

      // --- Regular printable character (insert at cursor) ---
      const text = data.toString("utf-8");
      const line = cursor.lines[cursor.row];
      cursor.lines[cursor.row] = line.slice(0, cursor.col) + text + line.slice(cursor.col);
      cursor.col += text.length;

      const p = currentPrompt(cursor, prompt, continuationPrompt);
      redrawLine(output, p, cursor.lines[cursor.row]);
      moveCursorToCol(output, cursor.col, visualLength(p));

      // Update autocomplete after character insertion
      if (completionProvider) {
        refreshAutocomplete(output, cursor, acRef, completionProvider);
      }
    };

    input.on("data", onData);
  });
}

// --- Helper actions --------------------------------------------------------

function insertNewline(
  output: Writable,
  cursor: CursorState,
  promptStr: string,
  contPrompt: string,
): void {
  // Split the current line at cursor position
  const before = cursor.lines[cursor.row].slice(0, cursor.col);
  const after = cursor.lines[cursor.row].slice(cursor.col);
  cursor.lines[cursor.row] = before;
  cursor.lines.splice(cursor.row + 1, 0, after);
  cursor.row++;
  cursor.col = 0;

  // Redraw: clear rest of current line, then draw new lines below
  const p = currentPrompt({ ...cursor, row: cursor.row - 1 }, promptStr, contPrompt);
  redrawLine(output, p, before);
  output.write("\n");

  // Redraw all lines from cursor.row onward
  for (let i = cursor.row; i < cursor.lines.length; i++) {
    const linePrompt = i === 0 ? promptStr : contPrompt;
    redrawLine(output, linePrompt, cursor.lines[i]);
    if (i < cursor.lines.length - 1) {
      output.write("\n");
    }
  }

  // Move cursor back up to the active row
  for (let i = cursor.lines.length - 1; i > cursor.row; i--) {
    output.write(ANSI_MOVE_UP);
  }
  moveCursorToCol(output, cursor.col, visualLength(contPrompt));
}

function handleBackspace(
  output: Writable,
  cursor: CursorState,
  promptStr: string,
  contPrompt: string,
): void {
  if (cursor.col > 0) {
    // Delete character before cursor
    const line = cursor.lines[cursor.row];
    cursor.lines[cursor.row] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
    cursor.col--;
    const p = currentPrompt(cursor, promptStr, contPrompt);
    redrawLine(output, p, cursor.lines[cursor.row]);
    moveCursorToCol(output, cursor.col, visualLength(p));
  } else if (cursor.row > 0) {
    // At column 0 — join with previous line
    const currentLine = cursor.lines[cursor.row];
    cursor.lines.splice(cursor.row, 1);
    cursor.row--;
    cursor.col = cursor.lines[cursor.row].length;
    cursor.lines[cursor.row] += currentLine;

    // Move up and redraw from current row downward
    output.write(ANSI_MOVE_UP);
    for (let i = cursor.row; i < cursor.lines.length; i++) {
      const p = i === 0 ? promptStr : contPrompt;
      redrawLine(output, p, cursor.lines[i]);
      if (i < cursor.lines.length - 1) {
        output.write("\n");
      }
    }
    // Clear the now-empty last visual line
    output.write("\n");
    redrawLine(output, "", "");

    // Move back up to cursor row
    const linesBelow = cursor.lines.length - cursor.row;
    for (let i = 0; i < linesBelow; i++) {
      output.write(ANSI_MOVE_UP);
    }
    const p = currentPrompt(cursor, promptStr, contPrompt);
    moveCursorToCol(output, cursor.col, visualLength(p));
  }
}

function handleArrow(
  direction: ArrowDirection,
  output: Writable,
  cursor: CursorState,
  hState: HistoryState,
  promptStr: string,
  contPrompt: string,
): void {
  switch (direction) {
    case "left": {
      handleArrowLeft(cursor);
      const p = currentPrompt(cursor, promptStr, contPrompt);
      moveCursorToCol(output, cursor.col, visualLength(p));
      return;
    }
    case "right": {
      handleArrowRight(cursor);
      const p = currentPrompt(cursor, promptStr, contPrompt);
      moveCursorToCol(output, cursor.col, visualLength(p));
      return;
    }
    case "up": {
      // Try to move the cursor up within the multi-line buffer first.
      const moved = handleArrowUp(cursor);
      if (moved) {
        // Terminal cursor physically moves up one row, then we reposition column.
        output.write(ANSI_MOVE_UP);
        const p = currentPrompt(cursor, promptStr, contPrompt);
        moveCursorToCol(output, cursor.col, visualLength(p));
        return;
      }
      // Already on the first row — try history navigation.
      const oldLineCount = cursor.lines.length;
      if (historyUp(hState, cursor)) {
        for (let i = oldLineCount - 1; i > 0; i--) {
          output.write(ANSI_MOVE_UP);
        }
        redrawAllLines(output, cursor, promptStr, contPrompt);
      }
      // At top of history with no movement — do nothing (cursor stays put).
      return;
    }
    case "down": {
      // Try to move the cursor down within the multi-line buffer first.
      const moved = handleArrowDown(cursor);
      if (moved) {
        // Terminal cursor physically moves down one row, then we reposition column.
        output.write(ANSI_MOVE_DOWN);
        const p = currentPrompt(cursor, promptStr, contPrompt);
        moveCursorToCol(output, cursor.col, visualLength(p));
        return;
      }
      // Already on the last row — try history navigation.
      const oldLineCount = cursor.lines.length;
      if (historyDown(hState, cursor)) {
        for (let i = oldLineCount - 1; i > 0; i--) {
          output.write(ANSI_MOVE_UP);
        }
        redrawAllLines(output, cursor, promptStr, contPrompt);
      }
      // At bottom of history with no movement — do nothing (cursor stays put).
      return;
    }
  }
}

export { readMultiLineInput, redrawLine, visualLength };
export type { CompletionItem, CursorState, HistoryState, InputResult, MultiLineInputOptions };
