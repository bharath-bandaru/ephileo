/**
 * Key classification for raw-mode terminal input.
 *
 * Each function inspects a raw Buffer chunk from stdin and determines
 * which logical key it represents. Arrow keys return a direction string;
 * modifier combos (Shift+Enter, Ctrl+C, etc.) have dedicated predicates.
 */

// --- Byte constants --------------------------------------------------------

const BYTE_CTRL_C = 3;
const BYTE_CTRL_D = 4;
const BYTE_TAB = 9;
const BYTE_BACKSPACE = 127;
const BYTE_CARRIAGE_RETURN = 13;
const BYTE_NEWLINE = 10;
const BYTE_ESCAPE = 27;

// --- Shift+Enter patterns --------------------------------------------------

/** Kitty keyboard protocol: ESC [ 13 ; 2 u */
const KITTY_SHIFT_ENTER = "\x1b[13;2u";

// --- Arrow key direction type ----------------------------------------------

type ArrowDirection = "up" | "down" | "left" | "right";

// --- Classification functions ----------------------------------------------

/** Kitty/Alt+Enter Shift+Enter detection. */
function isShiftEnter(data: Buffer): boolean {
  const str = data.toString("utf-8");
  if (str === KITTY_SHIFT_ENTER) return true;

  const ESC_CR_LENGTH = 2;
  if (data.length === ESC_CR_LENGTH && data[0] === BYTE_ESCAPE) {
    return data[1] === BYTE_CARRIAGE_RETURN || data[1] === BYTE_NEWLINE;
  }
  return false;
}

function isPlainEnter(data: Buffer): boolean {
  return data.length === 1 && (data[0] === BYTE_CARRIAGE_RETURN || data[0] === BYTE_NEWLINE);
}

function isBackspace(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_BACKSPACE;
}

function isCtrlC(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_CTRL_C;
}

function isCtrlD(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_CTRL_D;
}

/**
 * If the data chunk is an arrow key escape sequence, returns the direction.
 * Standard sequences: ESC [ A/B/C/D for up/down/right/left.
 */
function getArrowDirection(data: Buffer): ArrowDirection | null {
  const ARROW_SEQ_LENGTH = 3;
  if (data.length !== ARROW_SEQ_LENGTH) return null;
  if (data[0] !== BYTE_ESCAPE || data[1] !== 0x5b) return null;

  const ARROW_A = 0x41; // up
  const ARROW_B = 0x42; // down
  const ARROW_C = 0x43; // right
  const ARROW_D = 0x44; // left

  switch (data[2]) {
    case ARROW_A:
      return "up";
    case ARROW_B:
      return "down";
    case ARROW_C:
      return "right";
    case ARROW_D:
      return "left";
    default:
      return null;
  }
}

/** Standalone Escape key (single byte 0x1b, not part of a multi-byte sequence). */
function isEscape(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_ESCAPE;
}

/** Tab key (0x09). */
function isTab(data: Buffer): boolean {
  return data.length === 1 && data[0] === BYTE_TAB;
}

/** Any escape sequence that we don't specifically handle (e.g. F-keys, Home, End). */
function isUnhandledEscape(data: Buffer): boolean {
  if (data.length <= 1 || data[0] !== BYTE_ESCAPE) return false;
  if (isShiftEnter(data)) return false;
  if (getArrowDirection(data) !== null) return false;
  return true;
}

export {
  getArrowDirection,
  isBackspace,
  isCtrlC,
  isCtrlD,
  isEscape,
  isPlainEnter,
  isShiftEnter,
  isTab,
  isUnhandledEscape,
};
export type { ArrowDirection };
