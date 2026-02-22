/**
 * Multi-line raw-mode input handler for the Ephileo REPL.
 *
 * Reads stdin character by character in raw mode. Shift+Enter inserts a
 * newline (continuation), plain Enter submits the accumulated input.
 *
 * Shift+Enter detection relies on escape sequences emitted by modern
 * terminals (kitty keyboard protocol, iTerm2, WezTerm, etc.).
 */

import type { Readable, Writable } from "node:stream";

// --- ANSI escape sequences ------------------------------------------------

const ANSI_CLEAR_LINE = "\x1b[2K";
const ANSI_MOVE_TO_COL_1 = "\r";

// --- Key byte constants ---------------------------------------------------

const BYTE_CTRL_C = 3;
const BYTE_CTRL_D = 4;
const BYTE_BACKSPACE = 127;
const BYTE_CARRIAGE_RETURN = 13;
const BYTE_NEWLINE = 10;
const BYTE_ESCAPE = 27;

// --- Shift+Enter escape sequence patterns ---------------------------------

/** Kitty keyboard protocol: ESC [ 13 ; 2 u */
const KITTY_SHIFT_ENTER = "\x1b[13;2u";

// --- Public types ---------------------------------------------------------

interface MultiLineInputOptions {
  /** Primary prompt string (e.g. "> "). */
  prompt: string;
  /** Continuation prompt for subsequent lines (e.g. ".. "). */
  continuationPrompt: string;
  /** Readable stream to read from (defaults to process.stdin). */
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  /** Writable stream to write to (defaults to process.stderr). */
  output?: Writable;
}

type InputResult = { kind: "input"; value: string } | { kind: "eof" };

// --- Escape sequence classification ---------------------------------------

/**
 * Determines whether a raw data chunk represents a Shift+Enter sequence.
 *
 * Recognized sequences:
 * - Kitty protocol: `\x1b[13;2u`
 * - Alt+Enter style: `\x1b\r` or `\x1b\n`
 */
function isShiftEnter(data: Buffer): boolean {
  const str = data.toString("utf-8");

  // Kitty keyboard protocol
  if (str === KITTY_SHIFT_ENTER) return true;

  // ESC followed by carriage return or newline (Alt+Enter in many terminals)
  const ESC_CR_LENGTH = 2;
  if (data.length === ESC_CR_LENGTH && data[0] === BYTE_ESCAPE) {
    return data[1] === BYTE_CARRIAGE_RETURN || data[1] === BYTE_NEWLINE;
  }

  return false;
}

/**
 * Determines whether a raw data chunk is a plain Enter keypress.
 */
function isPlainEnter(data: Buffer): boolean {
  return data.length === 1 && (data[0] === BYTE_CARRIAGE_RETURN || data[0] === BYTE_NEWLINE);
}

/**
 * Determines whether a raw data chunk is a backspace keypress.
 */
function isBackspace(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_BACKSPACE;
}

/**
 * Determines whether a raw data chunk is Ctrl+C.
 */
function isCtrlC(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_CTRL_C;
}

/**
 * Determines whether a raw data chunk is Ctrl+D (EOF).
 */
function isCtrlD(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_CTRL_D;
}

/**
 * Determines whether a data chunk is an unrecognized escape sequence
 * (starts with ESC but is not Shift+Enter).
 */
function isOtherEscapeSequence(data: Buffer): boolean {
  return data.length > 1 && data[0] === BYTE_ESCAPE && !isShiftEnter(data);
}

// --- Display helpers ------------------------------------------------------

/**
 * Redraws the current line in the terminal, clearing what was there before.
 */
function redrawCurrentLine(output: Writable, prompt: string, lineContent: string): void {
  output.write(`${ANSI_MOVE_TO_COL_1}${ANSI_CLEAR_LINE}${prompt}${lineContent}`);
}

// --- Core input function --------------------------------------------------

/**
 * Reads a single multi-line input from the user via raw-mode stdin.
 *
 * - Plain Enter submits the full input.
 * - Shift+Enter (or Alt+Enter) inserts a newline continuation.
 * - Backspace deletes the last character (or joins with the previous line).
 * - Ctrl+C exits the process.
 * - Ctrl+D on an empty buffer signals EOF.
 *
 * Returns a promise that resolves with the complete input string, or an
 * EOF signal when the user presses Ctrl+D on an empty line.
 */
function readMultiLineInput(options: MultiLineInputOptions): Promise<InputResult> {
  const { prompt, continuationPrompt, input = process.stdin, output = process.stderr } = options;

  return new Promise((resolve) => {
    const lines: string[] = [""];

    const currentLineIndex = (): number => lines.length - 1;
    const currentPrompt = (): string => (currentLineIndex() === 0 ? prompt : continuationPrompt);

    // Show the initial prompt
    output.write(prompt);

    // Enter raw mode if available (TTY only)
    if (input.isTTY && input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();

    const cleanup = () => {
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
        const fullInput = lines.join("\n");
        if (fullInput.length === 0) {
          cleanup();
          output.write("\n");
          resolve({ kind: "eof" });
          return;
        }
        // Non-empty buffer: ignore Ctrl+D
        return;
      }

      // --- Shift+Enter: insert newline continuation ---
      if (isShiftEnter(data)) {
        output.write("\n");
        lines.push("");
        output.write(continuationPrompt);
        return;
      }

      // --- Plain Enter: submit ---
      if (isPlainEnter(data)) {
        cleanup();
        output.write("\n");
        resolve({ kind: "input", value: lines.join("\n") });
        return;
      }

      // --- Backspace ---
      if (isBackspace(data)) {
        const idx = currentLineIndex();
        if (lines[idx].length > 0) {
          // Delete the last character on the current line
          lines[idx] = lines[idx].slice(0, -1);
          redrawCurrentLine(output, currentPrompt(), lines[idx]);
        } else if (idx > 0) {
          // Current line is empty — join with the previous line
          lines.pop();
          const prevIdx = currentLineIndex();
          // Move cursor up and redraw the previous line
          output.write("\x1b[A");
          redrawCurrentLine(output, currentPrompt(), lines[prevIdx]);
        }
        return;
      }

      // --- Ignore unrecognized escape sequences (arrow keys, etc.) ---
      if (isOtherEscapeSequence(data)) {
        return;
      }

      // --- Regular printable character ---
      const text = data.toString("utf-8");
      const idx = currentLineIndex();
      lines[idx] += text;
      output.write(text);
    };

    input.on("data", onData);
  });
}

export {
  isBackspace,
  isCtrlC,
  isCtrlD,
  isOtherEscapeSequence,
  isPlainEnter,
  isShiftEnter,
  readMultiLineInput,
  redrawCurrentLine,
};
export type { InputResult, MultiLineInputOptions };
