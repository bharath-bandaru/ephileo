/**
 * Tool confirmation prompt — shows a colored preview of what a tool will do,
 * then asks the user to approve or deny.
 *
 * Used by the CLI layer to gate tool calls that have requiresConfirmation: true.
 * This file has no imports from cli/index.ts — it is self-contained.
 */

import type { Readable, Writable } from "node:stream";

// --- ANSI color constants --------------------------------------------------

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// --- Preview constants -----------------------------------------------------

const MAX_PREVIEW_LINES = 50;
const PREVIEW_BORDER = "─".repeat(60);

// --- Key byte constants ----------------------------------------------------

const BYTE_Y_LOWER = 121;
const BYTE_Y_UPPER = 89;
const BYTE_N_LOWER = 110;
const BYTE_N_UPPER = 78;
const BYTE_D_LOWER = 100;
const BYTE_D_UPPER = 68;
const BYTE_ESCAPE = 27;

// --- Public types ----------------------------------------------------------

export interface ConfirmPromptOptions {
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void; isRaw?: boolean };
  output?: Writable;
  /** Override output for line tracking. Takes precedence over output.write. */
  write?: (text: string) => void;
}

// --- Pure preview formatting ----------------------------------------------

/**
 * Formats a colored preview of what a tool is about to do.
 * Pure function — no I/O.
 */
export function formatToolPreview(
  toolName: string,
  args: Record<string, unknown>,
  options?: { showPrompt?: boolean },
): string {
  const showPrompt = options?.showPrompt ?? true;
  const lines: string[] = [];
  lines.push(`${BOLD}${PREVIEW_BORDER}${RESET}`);

  if (toolName === "write_file") {
    const path = String(args.path ?? "(unknown path)");
    const content = String(args.content ?? "");
    const contentLines = content.split("\n");
    const truncated = contentLines.length > MAX_PREVIEW_LINES;
    const displayLines = truncated ? contentLines.slice(0, MAX_PREVIEW_LINES) : contentLines;
    const extraCount = contentLines.length - MAX_PREVIEW_LINES;

    lines.push(`${BOLD}write_file${RESET} ${DIM}→${RESET} ${GREEN}${path}${RESET}`);
    lines.push("");
    for (const line of displayLines) {
      lines.push(`${GREEN}${line}${RESET}`);
    }
    if (truncated) {
      lines.push(`${DIM}... (${extraCount} more lines)${RESET}`);
    }
  } else if (toolName === "edit_file") {
    const path = String(args.path ?? "(unknown path)");
    const oldString = String(args.old_string ?? "");
    const newString = String(args.new_string ?? "");
    const replaceAll = Boolean(args.replace_all);

    lines.push(`${BOLD}edit_file${RESET} ${DIM}→${RESET} ${path}`);
    if (replaceAll) {
      lines.push(`${DIM}(replace_all: true)${RESET}`);
    }
    lines.push("");
    for (const line of oldString.split("\n")) {
      lines.push(`${RED}- ${line}${RESET}`);
    }
    lines.push("");
    for (const line of newString.split("\n")) {
      lines.push(`${GREEN}+ ${line}${RESET}`);
    }
  } else if (toolName === "shell") {
    const command = String(args.command ?? "(no command)");
    lines.push(`${BOLD}shell${RESET}`);
    lines.push("");
    lines.push(`${YELLOW}$ ${command}${RESET}`);
  } else {
    lines.push(`${BOLD}${toolName}${RESET}`);
    lines.push("");
    lines.push(JSON.stringify(args, null, 2));
  }

  lines.push(`${BOLD}${PREVIEW_BORDER}${RESET}`);
  if (showPrompt) {
    lines.push(`${DIM}[y - yes, n - no, d - don't ask again]${RESET} `);
  }

  return lines.join("\n");
}

// --- TTY confirmation prompt -----------------------------------------------

export type ConfirmResult = "yes" | "no" | "skip";

/**
 * Reads a single confirmation keypress from the user.
 *
 * - If input is not a TTY, auto-approves and writes a warning.
 * - If stdin is already in raw mode (hotkey listener active), attaches a
 *   temporary data listener without toggling raw mode.
 * - Accepts: y/Y → "yes", n/N/Escape → "no", d/D → "skip". Ignores other keys.
 */
export function readConfirmation(options?: ConfirmPromptOptions): Promise<ConfirmResult> {
  const input = (options?.input ?? process.stdin) as Readable & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
    isRaw?: boolean;
  };
  const fallbackOutput: Writable = options?.output ?? process.stderr;
  const emit =
    options?.write ??
    ((text: string) => {
      fallbackOutput.write(text);
    });

  if (!input.isTTY) {
    emit(`${DIM}[non-TTY input: auto-approving tool]${RESET}\n`);
    return Promise.resolve("yes");
  }

  const alreadyRaw = input.isRaw === true;

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const byte = chunk[0];
      if (byte === BYTE_Y_LOWER || byte === BYTE_Y_UPPER) {
        cleanup("yes");
      } else if (byte === BYTE_N_LOWER || byte === BYTE_N_UPPER || byte === BYTE_ESCAPE) {
        cleanup("no");
      } else if (byte === BYTE_D_LOWER || byte === BYTE_D_UPPER) {
        cleanup("skip");
      }
      // Ignore all other keys — wait for a valid keypress
    };

    const cleanup = (result: ConfirmResult) => {
      input.removeListener("data", onData);
      if (!alreadyRaw && input.setRawMode) {
        input.setRawMode(false);
      }
      const label = result === "yes" ? "y" : result === "no" ? "n" : "d";
      emit(`${label}\n`);
      resolve(result);
    };

    if (!alreadyRaw && input.setRawMode) {
      input.setRawMode(true);
    }
    input.resume();
    input.on("data", onData);
  });
}

/** Convenience wrapper — maps ConfirmResult to boolean (yes/skip → true, no → false). */
export function readYesNo(options?: ConfirmPromptOptions): Promise<boolean> {
  return readConfirmation(options).then((result) => result !== "no");
}

// --- Public confirmation entry point --------------------------------------

/**
 * Shows a formatted preview of what the tool will do, then asks for y/n.
 * Returns true if the user approves, false if they deny.
 *
 * Implements ConfirmationCallback so it can be passed directly to
 * ToolRegistry.setConfirmationCallback().
 */
export async function askConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  options?: ConfirmPromptOptions,
): Promise<boolean> {
  const fallbackOutput: Writable = options?.output ?? process.stderr;
  const emit =
    options?.write ??
    ((text: string) => {
      fallbackOutput.write(text);
    });
  emit(formatToolPreview(toolName, args));
  return readYesNo(options);
}
