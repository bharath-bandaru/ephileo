#!/usr/bin/env node

/**
 * Ephileo CLI — interactive REPL and one-shot command execution.
 *
 * Usage:
 *   pnpm dev                          # interactive REPL
 *   pnpm dev -- ask "what time is it" # one-shot question
 *   pnpm dev -- ask "list my files"   # uses tools automatically
 *
 * Press 'h' while the agent is thinking to toggle thinking visibility.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { buildSystemPrompt, runAgentLoop } from "../agent/index.js";
import { type EphileoConfig, getActiveProvider, loadConfig } from "../config/loader.js";
import { type ChatMessage, LLMClient } from "../llm/index.js";
import { registerBasicTools, ToolRegistry } from "../tools/index.js";
import { readMultiLineInput } from "./input.js";

// ANSI codes
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Key codes for hotkey detection
const KEY_CTRL_C = 3;
const KEY_H_LOWER = 104;
const KEY_H_UPPER = 72;

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

// Thinking visibility state — persists across turns, toggled with 'h'
let showThinking = true;

interface AskResult {
  response: string;
  hadThinking: boolean;
}

interface AskOptions {
  maxTurns?: number;
  /** Suppress [turn] logs and thinking display (used for init call). */
  silent?: boolean;
}

function formatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lines = msg.split("\n");
  const errorLine = `${RED}${lines[0]}${RESET}`;
  const instructionLines = lines.slice(1).map((l) => `${GREEN}${l}${RESET}`);
  return [errorLine, ...instructionLines].join("\n");
}

function loadMemory(memoryDir: string): string {
  try {
    return readFileSync(resolve(memoryDir, "learnings.md"), "utf-8");
  } catch {
    return "";
  }
}

function createAgent() {
  try {
    const config = loadConfig();
    const provider = getActiveProvider(config);
    const llm = new LLMClient({
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: provider.apiKey,
      maxTokens: config.agent.maxTokens,
    });
    const tools = new ToolRegistry();
    registerBasicTools(tools, config.memory.dir);
    return { llm, tools, config };
  } catch (err: unknown) {
    console.error(`\n${formatError(err)}\n`);
    process.exit(1);
  }
}

/**
 * Listen for 'h' keypress while the agent is running.
 * Switches stdin to raw mode so we can catch individual keys without Enter.
 * Returns a cleanup function to restore normal mode.
 */
function startHotkeyListener(): () => void {
  if (!process.stdin.isTTY) return () => {};

  const onData = (key: Buffer) => {
    // Ctrl+C — exit
    if (key[0] === KEY_CTRL_C) {
      process.stderr.write(`${RESET}\n`);
      process.exit(0);
    }
    // 'h' or 'H' — toggle thinking
    if (key[0] === KEY_H_LOWER || key[0] === KEY_H_UPPER) {
      showThinking = !showThinking;
      process.stderr.write(
        `\n  ${YELLOW}[thinking ${showThinking ? "visible" : "hidden"} — press h to toggle]${RESET}\n`,
      );
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

/** Animated spinner for long-running silent operations. Returns a stop function. */
function startSpinner(message: string): () => void {
  let frameIdx = 0;
  process.stderr.write(`${message} ${YELLOW}${SPINNER_FRAMES[0]}${RESET}`);
  const timer = setInterval(() => {
    frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
    process.stderr.write(`\r${message} ${YELLOW}${SPINNER_FRAMES[frameIdx]}${RESET}`);
  }, SPINNER_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    process.stderr.write(`\r${" ".repeat(message.length + 2)}\r`);
  };
}

async function ask(
  input: string,
  llm: LLMClient,
  tools: ToolRegistry,
  systemPrompt: string,
  opts: AskOptions = {},
): Promise<AskResult> {
  const { maxTurns, silent = false } = opts;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input },
  ];

  let lastWasThinking = false;
  let detectedThinking = false;

  // Start listening for 'h' hotkey during agent execution
  const stopHotkeys = startHotkeyListener();

  try {
    const result = await runAgentLoop(
      messages,
      llm,
      tools,
      // Log function for turn/tool events
      (msg) => {
        if (silent) return;
        if (lastWasThinking) {
          process.stderr.write(`${RESET}\n`);
          lastWasThinking = false;
        }
        process.stderr.write(`  ${GREEN}${msg}${RESET}\n`);
      },
      // Live streaming callback — always tracks thinking, only displays when not silent
      (token, isThinking) => {
        if (isThinking) {
          detectedThinking = true;
          if (!silent && showThinking) {
            process.stderr.write(`${DIM}${token}${RESET}`);
          }
          lastWasThinking = !silent;
        } else {
          if (lastWasThinking) {
            if (showThinking) {
              process.stderr.write(`${RESET}\n`);
            }
            lastWasThinking = false;
          }
        }
      },
      maxTurns,
    );

    if (lastWasThinking && showThinking) {
      process.stderr.write(`${RESET}\n`);
    }

    return { response: result.response, hadThinking: detectedThinking };
  } finally {
    // Restore stdin so the input handler can use it
    stopHotkeys();
  }
}

async function repl(llm: LLMClient, tools: ToolRegistry, config: EphileoConfig): Promise<void> {
  console.log("Ephileo v0.1 — Local AI Agent");
  console.log(`Provider: ${config.provider} (${llm.opts.model})`);
  console.log(`Tools: ${tools.listNames().join(", ")}`);

  // Initial LLM call — detects thinking support and greets/asks name (silent: no logs/thinking)
  const stopSpinner = startSpinner("waking ephileo...");
  const memory = loadMemory(config.memory.dir);
  const systemPrompt = buildSystemPrompt(memory);
  let greeting: string;
  let hadThinking: boolean;
  try {
    const result = await ask("Hello! Introduce yourself briefly.", llm, tools, systemPrompt, {
      maxTurns: config.agent.maxTurns,
      silent: true,
    });
    greeting = result.response;
    hadThinking = result.hadThinking;
  } catch (err: unknown) {
    stopSpinner();
    console.error(`\n${formatError(err)}\n`);
    process.exit(1);
  }
  stopSpinner();

  if (hadThinking) {
    console.log(`Press ${YELLOW}h${RESET} while thinking to toggle thought visibility.`);
  }
  console.log("Shift+Enter for new line, Enter to send.");
  console.log('Type "quit" to exit.\n');
  console.log(`${BLUE}ephileo>${RESET} ${greeting}\n`);

  const prompt = `${BLUE}> ${RESET}`;
  const continuationPrompt = `${BLUE}..${RESET} `;

  // Main REPL loop — each iteration reads one multi-line input
  for (;;) {
    const result = await readMultiLineInput({ prompt, continuationPrompt });

    if (result.kind === "eof") {
      console.log("Goodbye.");
      process.exit(0);
    }

    const input = result.value.trim();
    if (!input) continue;

    if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
      console.log("Goodbye.");
      process.exit(0);
    }

    // Show labelled echo of user input (replace newlines for compact display)
    const displayInput = input.includes("\n") ? input.replace(/\n/g, " \\n ") : input;
    process.stderr.write(`  ${GREEN}[user]${RESET} ${displayInput}\n`);

    try {
      const freshMemory = loadMemory(config.memory.dir);
      const freshPrompt = buildSystemPrompt(freshMemory);
      const { response } = await ask(input, llm, tools, freshPrompt, {
        maxTurns: config.agent.maxTurns,
      });
      console.log(`\n${BLUE}ephileo>${RESET} ${response}\n`);
    } catch (err: unknown) {
      console.error(`\n${formatError(err)}\n`);
    }
  }
}

// --- CLI program ---

const program = new Command();

program.name("ephileo").description("Ephileo — your local AI agent").version("0.1.0");

program
  .command("ask")
  .description("Ask Ephileo a question or give it a task (one-shot)")
  .argument("<input...>", "Your question or task")
  .action(async (inputParts: string[]) => {
    const { llm, tools, config } = createAgent();
    const memory = loadMemory(config.memory.dir);
    const systemPrompt = buildSystemPrompt(memory);
    const { response } = await ask(inputParts.join(" "), llm, tools, systemPrompt, {
      maxTurns: config.agent.maxTurns,
    });
    console.log(response);
  });

program
  .command("chat", { isDefault: true })
  .description("Start interactive chat (default)")
  .action(async () => {
    const { llm, tools, config } = createAgent();
    await repl(llm, tools, config);
  });

program.parse();
