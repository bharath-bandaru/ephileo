/**
 * Shared ANSI rendering helpers for terminal input handling.
 *
 * Extracted from input.ts to share with autocomplete.ts and keep file sizes manageable.
 */

import type { Writable } from "node:stream";

// --- ANSI escape constants --------------------------------------------------

export const ANSI_CLEAR_LINE = "\x1b[2K";
export const ANSI_MOVE_TO_COL_1 = "\r";
export const ANSI_MOVE_UP = "\x1b[A";
export const ANSI_MOVE_DOWN = "\x1b[B";

/** The ESC byte value used to start ANSI escape sequences. */
export const BYTE_ESC = 0x1b;

// --- Visual length -----------------------------------------------------------

/**
 * Returns the visible character length of a string after stripping ANSI CSI
 * escape sequences (ESC [ ... letter). Required so that colored prompts don't
 * throw off column calculations — escape bytes occupy no terminal columns.
 *
 * Implemented without a regex literal to avoid Biome's noControlCharactersInRegex
 * restriction (ESC is a control character that triggers the rule).
 */
export function visualLength(str: string): number {
  let visible = 0;
  let inEscape = false;
  let sawBracket = false;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);

    if (inEscape) {
      if (!sawBracket) {
        // Second byte of escape: must be '[' to be a CSI sequence we strip
        if (code === 0x5b) {
          sawBracket = true;
        } else {
          // Not a CSI sequence — count the ESC we skipped and this char
          visible += 2;
          inEscape = false;
          sawBracket = false;
        }
      } else {
        // Inside CSI params: letters [a-zA-Z] terminate the sequence
        const isUpperAlpha = code >= 0x41 && code <= 0x5a;
        const isLowerAlpha = code >= 0x61 && code <= 0x7a;
        if (isUpperAlpha || isLowerAlpha) {
          inEscape = false;
          sawBracket = false;
        }
        // Digits and semicolons are param bytes — skip them silently
      }
    } else if (code === BYTE_ESC) {
      inEscape = true;
      sawBracket = false;
    } else {
      visible++;
    }
  }

  return visible;
}

/** Move the cursor to a specific column (1-indexed for ANSI). */
export function moveCursorToCol(output: Writable, col: number, promptVisualLen: number): void {
  output.write(`\x1b[${col + promptVisualLen + 1}G`);
}

/** Clear the current terminal line and rewrite prompt + content. */
export function redrawLine(output: Writable, prompt: string, content: string): void {
  output.write(`${ANSI_MOVE_TO_COL_1}${ANSI_CLEAR_LINE}${prompt}${content}`);
}
