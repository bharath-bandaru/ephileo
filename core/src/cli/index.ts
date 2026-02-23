#!/usr/bin/env node

/**
 * Ephileo CLI — interactive REPL and one-shot command execution.
 *
 * Usage:
 *   pnpm dev                          # interactive REPL
 *   pnpm dev -- ask "what time is it" # one-shot question
 *   pnpm dev -- ask "list my files"   # uses tools automatically
 *
 * Press 't' while the agent is thinking to toggle thinking visibility.
 * Press Escape to cancel the current operation and return to the prompt.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { buildSystemPrompt } from "../agent/index.js";
import { type EphileoConfig, getActiveProvider, loadConfig } from "../config/loader.js";
import { type ChatMessage, LLMClient } from "../llm/index.js";
import type { PermissionLevel } from "../tools/index.js";
import { registerBasicTools, ToolRegistry } from "../tools/index.js";
import { BLUE, DIM, GREEN, RED, RESET, YELLOW } from "./ansi.js";
import { ask, clearTrackedOutput, createTrackedWriter } from "./ask.js";
import { CommandRegistry } from "./commands.js";
import { askConfirmation } from "./confirm.js";
import { appendHistory, loadHistory } from "./history.js";
import { readMultiLineInput } from "./input.js";
import {
  handlePermissionsCommand,
  PERMISSION_MENU_LINE_COUNT,
  promptPermissionLevel,
} from "./permissions.js";
import { loadSettings, saveSettings } from "./settings.js";

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
    tools.setConfirmationCallback(askConfirmation);
    return { llm, tools, config };
  } catch (err: unknown) {
    console.error(`\n${formatError(err)}\n`);
    process.exit(1);
  }
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

async function repl(llm: LLMClient, tools: ToolRegistry, config: EphileoConfig): Promise<void> {
  console.log(`\n${YELLOW}Ephileo v0.1${RESET} — your local AI agent\n`);
  console.log(`Provider: ${config.provider} (${llm.opts.model})`);
  console.log(`Tools: ${tools.listNames().join(", ")}\n`);

  // Load saved permission level or prompt on first run
  const settings = loadSettings();
  let permissionLevel: PermissionLevel;
  if (settings.permissionLevel) {
    permissionLevel = settings.permissionLevel;
  } else {
    permissionLevel = await promptPermissionLevel();
    saveSettings({ permissionLevel });
    // Clear the permission menu lines (cursor is on a new line after user's keypress)
    let clearMenu = "\x1b[2K";
    for (let i = 0; i < PERMISSION_MENU_LINE_COUNT; i++) {
      clearMenu += "\x1b[1A\x1b[2K";
    }
    clearMenu += "\x1b[G";
    process.stderr.write(clearMenu);
  }
  tools.setPermissionLevel(permissionLevel);
  console.log(`${DIM}Tip: use / for more options or any preference changes${RESET}\n`);

  // Slash command registry — extensible for future commands
  const commands = new CommandRegistry();
  commands.register("permissions", "View or change permission level", async () => {
    permissionLevel = await handlePermissionsCommand(permissionLevel);
    tools.setPermissionLevel(permissionLevel);
    saveSettings({ permissionLevel });
    return { handled: true };
  });
  commands.register("help", "Show available commands", async () => {
    return { handled: true, message: commands.formatHelp() };
  });
  // Initial LLM call — detects thinking support and greets/asks name (silent: no logs/thinking)
  const stopSpinner = startSpinner("waking ephileo...");
  const memory = loadMemory(config.memory.dir);
  const systemPrompt = buildSystemPrompt(memory);
  // Shared conversation history for the session — persists across REPL turns
  const conversationMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // Register commands that need access to conversation state
  commands.register("quit", "Exit Ephileo", async () => {
    console.log("Goodbye.");
    process.exit(0);
  });
  commands.register("clear", "Clear chat and start fresh", async () => {
    conversationMessages.length = 1;
    process.stderr.write("\x1b[2J\x1b[H");
    return { handled: true, message: `${DIM}Chat cleared.${RESET}` };
  });
  let greeting: string;
  try {
    const result = await ask("Hello! Introduce yourself briefly.", llm, tools, systemPrompt, {
      maxTurns: config.agent.maxTurns,
      silent: true,
      onFirstThinkingDisplay: () => {
        // Stop the spinner animation but keep "waking ephileo..." on screen
        stopSpinner();
        process.stderr.write("waking ephileo... ok, I am still waking up _'o'- \n");
      },
    });
    greeting = result.response;
  } catch (err: unknown) {
    stopSpinner();
    console.error(`\n${formatError(err)}\n`);
    process.exit(1);
  }
  stopSpinner();
  // Clear the "waking ephileo..." line and the blank dots line above
  process.stderr.write("\x1b[2K\x1b[1A\x1b[2K\x1b[G");
  console.log(`${BLUE}ok, I am here for you!${RESET}\n`);
  console.log(
    `${GREEN}Tip: Use [\\ and Enter] or [Alt + Enter] for new line, Enter to send.${RESET}`,
  );
  console.log(`${DIM}Type /help for commands, /quit to exit.${RESET}\n`);
  console.log(`${BLUE}ephileo.${RESET} ${greeting}\n`);

  const prompt = `${BLUE}> ${RESET}`;
  const continuationPrompt = `${BLUE}..${RESET} `;

  // Command history — stored in .ephileo_history at project root
  const historyFile = resolve(process.cwd(), ".ephileo_history");
  const history = loadHistory(historyFile);

  // Main REPL loop — each iteration reads one multi-line input
  for (;;) {
    const result = await readMultiLineInput({
      prompt,
      continuationPrompt,
      history,
      completionProvider: () => commands.getCompletions(),
    });

    if (result.kind === "eof") {
      console.log("Goodbye.");
      process.exit(0);
    }

    const input = result.value.trim();
    if (!input) continue;

    // Slash commands — handled before saving to history or sending to LLM
    if (input.startsWith("/")) {
      const cmdResult = await commands.dispatch(input);
      if (cmdResult?.handled) {
        if (cmdResult.message) console.log(`\n${cmdResult.message}\n`);
        continue;
      }
    }

    // Save to history and keep in-memory list in sync
    appendHistory(historyFile, input);
    history.push(input);

    // Track intermediate output lines so we can clear them after the response
    const { write, counter } = createTrackedWriter();

    write(`  ${DIM}press t to show/hide thinking${RESET}\n`);
    // Show labelled echo of user input (replace newlines for compact display)
    const displayInput = input.includes("\n") ? input.replace(/\n/g, " \\n ") : input;
    write(`  ${GREEN}[user]${RESET} ${displayInput}\n`);

    try {
      const freshMemory = loadMemory(config.memory.dir);
      const freshPrompt = buildSystemPrompt(freshMemory);
      // Refresh the system prompt in-place so memory updates take effect each turn
      conversationMessages[0] = { role: "system", content: freshPrompt };
      const { response, cancelled } = await ask(input, llm, tools, freshPrompt, {
        maxTurns: config.agent.maxTurns,
        messages: conversationMessages,
        write,
      });
      // Move cursor up past all intermediate output and clear it
      clearTrackedOutput(counter);
      if (cancelled) {
        console.log(`\n${DIM}[cancelled]${RESET}\n`);
      } else {
        console.log(`\n${BLUE}ephileo.${RESET} ${response}\n`);
      }
    } catch (err: unknown) {
      // Keep intermediate output visible on error — useful for debugging
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
