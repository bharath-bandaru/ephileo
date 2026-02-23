/** ANSI color/style constants shared across CLI modules. */

export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const BLUE = "\x1b[34m";
export const YELLOW = "\x1b[33m";
export const RESET = "\x1b[0m";
// biome-ignore lint/suspicious/noControlCharactersInRegex: Matching ANSI ESC (\x1b) is intentional
export const ANSI_ESCAPE_PATTERN = /\x1b(?:\[[0-9;?]*[a-zA-Z]|[0-9])/g;
