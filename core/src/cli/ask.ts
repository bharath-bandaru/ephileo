/**
 * Agent ask function — sends a user message through the agent loop with
 * streaming display, spinners, hotkey handling, and confirmation prompts.
 *
 * Extracted from cli/index.ts to keep file sizes manageable.
 */

import { runAgentLoop } from "../agent/index.js";
import { UserAbortError } from "../errors.js";
import type { ChatMessage, LLMClient } from "../llm/index.js";
import type { ToolRegistry } from "../tools/index.js";
import { ANSI_ESCAPE_PATTERN, BLUE, DIM, GREEN, RESET, YELLOW } from "./ansi.js";
import { formatToolPreview, readConfirmation } from "./confirm.js";

const DEFAULT_TERM_WIDTH = 80;

// Key codes for hotkey detection
const KEY_CTRL_C = 3;
const KEY_ESCAPE = 27;
const KEY_T_LOWER = 116;
const KEY_T_UPPER = 84;

// Spinner animation frames and timing
const SPINNER_FRAMES = [
  "\u28CB",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283C",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F",
];
const SPINNER_INTERVAL_MS = 80;
const SPINNER_PADDING = 4; // 2-space indent + spinner char + space
const DOTS_INTERVAL_MS = 400;

// Thinking visibility state — persists across turns, toggled with 't'
let showThinking = false;

// --- Output tracking -------------------------------------------------------

export interface OutputCounter {
  lines: number;
  col: number;
}

/** Write to stderr while tracking visual line count for later clearing. */
export function writeTracked(text: string, counter: OutputCounter, termWidth: number): void {
  for (const ch of text.replace(ANSI_ESCAPE_PATTERN, "")) {
    if (ch === "\n") {
      counter.lines++;
      counter.col = 0;
    } else if (ch === "\r") {
      counter.col = 0;
    } else {
      counter.col++;
      // Terminal defers wrap until the next char, so only count wrap when col exceeds width
      if (counter.col > termWidth) {
        counter.lines++;
        counter.col = 1;
      }
    }
  }
  process.stderr.write(text);
}

/**
 * Erase all tracked intermediate output using per-line clearing (same technique as Ink).
 * Clears current line first, then moves up one row at a time clearing each.
 */
export function clearTrackedOutput(counter: OutputCounter): void {
  if (counter.lines <= 0 && counter.col <= 0) return;
  // \x1b[2K = clear entire current line
  let clear = "\x1b[2K";
  for (let i = 0; i < counter.lines; i++) {
    // \x1b[1A = cursor up 1 row, \x1b[2K = clear entire line
    clear += "\x1b[1A\x1b[2K";
  }
  // \x1b[G = cursor to column 1 (leftmost)
  clear += "\x1b[G";
  process.stderr.write(clear);
}

// --- Spinners --------------------------------------------------------------

/** Animated spinner that routes through a tracked write function for line counting. */
export function startTrackedSpinner(message: string, write: (text: string) => void): () => void {
  let frameIdx = 0;
  write(`  ${YELLOW}${SPINNER_FRAMES[0]}${RESET} ${message}`);
  const timer = setInterval(() => {
    frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
    write(`\r  ${YELLOW}${SPINNER_FRAMES[frameIdx]}${RESET} ${message}`);
  }, SPINNER_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    const visualLen = message.replace(ANSI_ESCAPE_PATTERN, "").length + SPINNER_PADDING;
    write(`\r${" ".repeat(visualLen)}\r`);
  };
}

// --- Hotkey listener -------------------------------------------------------

/**
 * Listen for keypresses while the agent is running.
 * Switches stdin to raw mode so we can catch individual keys without Enter.
 * Returns a cleanup function to restore normal mode.
 */
function startHotkeyListener(onEscape?: () => void): () => void {
  if (!process.stdin.isTTY) return () => {};

  const onData = (key: Buffer) => {
    // Ctrl+C — exit
    if (key[0] === KEY_CTRL_C) {
      process.stderr.write(`${RESET}\n`);
      process.exit(0);
    }
    // Escape — cancel current operation (bare Escape is 1 byte; ANSI sequences are longer)
    if (key.length === 1 && key[0] === KEY_ESCAPE && onEscape) {
      onEscape();
    }
    // 't' or 'T' — toggle thinking
    if (key[0] === KEY_T_LOWER || key[0] === KEY_T_UPPER) {
      showThinking = !showThinking;
    }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume(); // resume stdin — may have been paused by readline
  process.stdin.on("data", onData);

  return () => {
    process.stdin.removeListener("data", onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

// --- Ask function ----------------------------------------------------------

export interface AskResult {
  response: string;
  hadThinking: boolean;
  cancelled?: boolean;
}

export interface AskOptions {
  maxTurns?: number;
  /** Suppress [turn] logs and thinking display (used for init call). */
  silent?: boolean;
  /** Existing conversation messages. If provided, user input is appended here instead of creating fresh messages. */
  messages?: ChatMessage[];
  /** Called once before the first thinking token is displayed, to clear overlapping UI (e.g. spinner). */
  onFirstThinkingDisplay?: () => void;
  /** Tracked write function for intermediate output — enables post-response line clearing. */
  write?: (text: string) => void;
}

export async function ask(
  input: string,
  llm: LLMClient,
  tools: ToolRegistry,
  systemPrompt: string,
  opts: AskOptions = {},
): Promise<AskResult> {
  const { maxTurns, silent = false, onFirstThinkingDisplay } = opts;
  const write =
    opts.write ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const msgs: ChatMessage[] = opts.messages ?? [{ role: "system", content: systemPrompt }];
  msgs.push({ role: "user", content: input });

  let detectedThinking = false;
  let thinkingStartedThisCall = false;
  let activeSpinner: (() => void) | null = null;
  let skipConfirmation = false;

  const stopActiveSpinner = () => {
    if (activeSpinner) {
      activeSpinner();
      activeSpinner = null;
    }
  };

  // AbortController for Escape-to-cancel — abort() fires when user presses Escape
  const abortController = new AbortController();

  // Start listening for hotkeys during agent execution
  const stopHotkeys = startHotkeyListener(() => abortController.abort());

  // Spinner-aware confirmation: animated prompt while waiting, then running spinner after approval
  tools.setConfirmationCallback(async (toolName, toolArgs) => {
    if (skipConfirmation) {
      activeSpinner = startTrackedSpinner(`${DIM}running ${toolName}...${RESET}`, write);
      return true;
    }
    stopActiveSpinner();
    write(formatToolPreview(toolName, toolArgs, { showPrompt: false }));
    write("\n");
    const promptText = `${DIM}waiting for your response...  [y - yes, n - no, d - don't ask again]${RESET}`;
    activeSpinner = startTrackedSpinner(promptText, write);
    const result = await readConfirmation({ write });
    stopActiveSpinner();
    if (result === "skip") {
      skipConfirmation = true;
    }
    if (result !== "no") {
      activeSpinner = startTrackedSpinner(`${DIM}running ${toolName}...${RESET}`, write);
    }
    return result !== "no";
  });

  try {
    const result = await runAgentLoop(
      msgs,
      llm,
      tools,
      // Log function for turn/tool events
      (msg) => {
        if (silent) return;
        stopActiveSpinner();
        thinkingStartedThisCall = false;
        write(`  ${GREEN}${msg}${RESET}\n`);
      },
      // Live streaming callback — thinking display controlled by showThinking (toggled with 't')
      // The REPL caller tracks lines and clears all intermediate output after ask() returns.
      (token, isThinking) => {
        if (isThinking) {
          detectedThinking = true;
          if (!thinkingStartedThisCall) {
            thinkingStartedThisCall = true;
            stopActiveSpinner();
            onFirstThinkingDisplay?.();
            if (silent) {
              let dotIdx = 0;
              const msg = "booting up";
              const frames = [".", "..", "..."];
              write(`${BLUE}${msg}${frames[0]}${RESET}`);
              const timer = setInterval(() => {
                dotIdx = (dotIdx + 1) % frames.length;
                const pad = " ".repeat(frames.length - frames[dotIdx].length);
                write(`\r${BLUE}${msg}${frames[dotIdx]}${RESET}${pad}`);
              }, DOTS_INTERVAL_MS);
              activeSpinner = () => {
                clearInterval(timer);
                write(`\r${" ".repeat(msg.length + frames.length)}\r`);
              };
            } else if (showThinking) {
              write(`  ${YELLOW}[thinking]${RESET}\n`);
            } else {
              activeSpinner = startTrackedSpinner(`${YELLOW}[thinking]${RESET}`, write);
            }
          }
          if (showThinking) {
            if (activeSpinner) {
              stopActiveSpinner();
              write("\n");
            }
            write(`${DIM}${token}${RESET}`);
          }
        } else if (!silent) {
          stopActiveSpinner();
        }
      },
      maxTurns,
      abortController.signal,
    );

    return { response: result.response, hadThinking: detectedThinking };
  } catch (err: unknown) {
    if (err instanceof UserAbortError) {
      // Save partial content to conversation history so context isn't lost
      if (err.partialContent) {
        msgs.push({
          role: "assistant",
          content: `${err.partialContent}\n\n[Response interrupted by user]`,
        });
      }
      return { response: "[Cancelled]", hadThinking: detectedThinking, cancelled: true };
    }
    throw err;
  } finally {
    stopActiveSpinner();
    stopHotkeys();
  }
}

/** Create a tracked write function for the REPL. */
export function createTrackedWriter(): {
  write: (text: string) => void;
  counter: OutputCounter;
} {
  const counter: OutputCounter = { lines: 0, col: 0 };
  const termWidth = process.stderr.columns || DEFAULT_TERM_WIDTH;
  const write = (text: string) => writeTracked(text, counter, termWidth);
  return { write, counter };
}
