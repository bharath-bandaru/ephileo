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

import { createInterface } from "node:readline";
import { Command } from "commander";
import { runAgentLoop } from "../agent/index.js";
import { type EphileoConfig, getActiveProvider, loadConfig } from "../config/loader.js";
import { type ChatMessage, LLMClient } from "../llm/index.js";
import { registerBasicTools, ToolRegistry } from "../tools/index.js";

// ANSI codes
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Key codes for hotkey detection
const KEY_CTRL_C = 3;
const KEY_H_LOWER = 104;
const KEY_H_UPPER = 72;

// Thinking visibility state — persists across turns, toggled with 'h'
let showThinking = true;

const SYSTEM_PROMPT = `You are Ephileo, a local AI assistant running on the user's machine. You have \
access to tools that let you interact with the filesystem, run commands, and \
record what you learn.

Guidelines:
- Use tools when you need to take actions. Don't just describe what you would do — actually do it.
- When you discover something interesting or learn something new, use save_learning to record it.
- Be direct and concise.
- You run fully locally — no data leaves this machine.
- If a task requires multiple steps, work through them one at a time.`;

function createAgent() {
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

async function ask(
  input: string,
  llm: LLMClient,
  tools: ToolRegistry,
  maxTurns?: number,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ];

  let lastWasThinking = false;

  // Start listening for 'h' hotkey during agent execution
  const stopHotkeys = startHotkeyListener();

  try {
    const result = await runAgentLoop(
      messages,
      llm,
      tools,
      // Log function for turn/tool events
      (msg) => {
        if (lastWasThinking) {
          process.stderr.write(`${RESET}\n`);
          lastWasThinking = false;
        }
        process.stderr.write(`  ${GREEN}${msg}${RESET}\n`);
      },
      // Live streaming callback
      (token, isThinking) => {
        if (isThinking) {
          if (showThinking) {
            process.stderr.write(`${DIM}${token}${RESET}`);
          }
          lastWasThinking = true;
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

    return result.response;
  } finally {
    // Restore stdin for readline
    stopHotkeys();
  }
}

async function repl(llm: LLMClient, tools: ToolRegistry, config: EphileoConfig): Promise<void> {
  console.log("Ephileo v0.1 — Local AI Agent");
  console.log(`Provider: ${config.provider} (${llm.opts.model})`);
  console.log(`Tools: ${tools.listNames().join(", ")}`);
  console.log(`Press ${YELLOW}h${RESET} while thinking to toggle thought visibility.`);
  console.log('Type "quit" to exit.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BLUE}you> ${RESET}`,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
      console.log("Goodbye.");
      rl.close();
      return;
    }

    // Show labelled echo of user input
    process.stderr.write(`  ${GREEN}[user]${RESET} ${input}\n`);

    // Pause readline so it doesn't conflict with raw mode hotkeys
    rl.pause();

    try {
      const response = await ask(input, llm, tools, config.agent.maxTurns);
      console.log(`\n${BLUE}ephileo>${RESET} ${response}\n`);
    } catch (err) {
      console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}\n`);
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
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
    const response = await ask(inputParts.join(" "), llm, tools, config.agent.maxTurns);
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
