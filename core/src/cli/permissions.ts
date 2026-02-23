/**
 * Permission level prompt and command handler.
 *
 * Controls which tool groups require user confirmation:
 * - write-only: only write/edit need approval (default)
 * - read-and-write: all tools need approval (including shell, reads)
 * - auto-accept: skip all confirmations
 */

import type { Readable, Writable } from "node:stream";
import type { PermissionLevel } from "../tools/index.js";
import { BLUE, DIM, GREEN, RESET, YELLOW } from "./ansi.js";

// --- Key byte constants ----------------------------------------------------

const BYTE_1 = 0x31;
const BYTE_2 = 0x32;
const BYTE_3 = 0x33;
const BYTE_CR = 0x0d;
const BYTE_LF = 0x0a;

// --- Permission options ----------------------------------------------------

interface PermissionOption {
  level: PermissionLevel;
  label: string;
  description: string;
}

const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  {
    level: "write-only",
    label: "write only (recommended)",
    description: "write/edit need approval",
  },
  {
    level: "read-and-write",
    label: "read and write",
    description: "all tools need approval",
  },
  {
    level: "auto-accept",
    label: "auto accept all",
    description: "skip all confirmations",
  },
];

// Number of visible lines the permission menu occupies (header + options + select prompt)
const MENU_HEADER_LINES = 1;
const MENU_SELECT_LINES = 1;
export const PERMISSION_MENU_LINE_COUNT =
  MENU_HEADER_LINES + PERMISSION_OPTIONS.length + MENU_SELECT_LINES;

// --- Public types ----------------------------------------------------------

export interface PermissionPromptOptions {
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void; isRaw?: boolean };
  output?: Writable;
}

// --- Pure formatting -------------------------------------------------------

/** Format the current permission level for display. */
export function formatPermissionStatus(level: PermissionLevel): string {
  const option = PERMISSION_OPTIONS.find((o) => o.level === level);
  if (!option) return level;
  return `${option.label} ${DIM}(${option.description})${RESET}`;
}

/** Format the full permission menu. */
function formatPermissionMenu(): string {
  const lines: string[] = [];
  lines.push(`${YELLOW}Permission level:${RESET}`);
  for (let i = 0; i < PERMISSION_OPTIONS.length; i++) {
    const opt = PERMISSION_OPTIONS[i];
    const num = i + 1;
    lines.push(`  ${GREEN}[${num}]${RESET} ${opt.label} ${DIM}— ${opt.description}${RESET}`);
  }
  lines.push(`${DIM}Select [1-3, Enter = 1]:${RESET} `);
  return lines.join("\n");
}

// --- Prompt function -------------------------------------------------------

/**
 * Show a numbered permission prompt and read the user's choice.
 * Returns the selected PermissionLevel.
 * If stdin is not a TTY, returns "write-only" as a safe default.
 */
export function promptPermissionLevel(options?: PermissionPromptOptions): Promise<PermissionLevel> {
  const input = (options?.input ?? process.stdin) as Readable & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
    isRaw?: boolean;
  };
  const output: Writable = options?.output ?? process.stderr;

  if (!input.isTTY) {
    output.write(`${DIM}[non-TTY input: using default write-only permissions]${RESET}\n`);
    return Promise.resolve("write-only");
  }

  output.write(formatPermissionMenu());

  const alreadyRaw = input.isRaw === true;

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const byte = chunk[0];
      if (byte === BYTE_1 || byte === BYTE_CR || byte === BYTE_LF) {
        finish("write-only", "1");
      } else if (byte === BYTE_2) {
        finish("read-and-write", "2");
      } else if (byte === BYTE_3) {
        finish("auto-accept", "3");
      }
      // Ignore all other keys — wait for a valid keypress
    };

    const finish = (level: PermissionLevel, label: string) => {
      input.removeListener("data", onData);
      if (!alreadyRaw && input.setRawMode) {
        input.setRawMode(false);
      }
      output.write(`${label}\n`);
      resolve(level);
    };

    if (!alreadyRaw && input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();
    input.on("data", onData);
  });
}

// --- Command handler -------------------------------------------------------

/**
 * Handle the /permissions slash command.
 * Shows the current level and prompts for a new selection.
 * Returns the (possibly changed) permission level.
 */
export async function handlePermissionsCommand(
  currentLevel: PermissionLevel,
  options?: PermissionPromptOptions,
): Promise<PermissionLevel> {
  const output: Writable = options?.output ?? process.stderr;
  output.write(`${BLUE}Current:${RESET} ${formatPermissionStatus(currentLevel)}\n`);
  return promptPermissionLevel(options);
}
