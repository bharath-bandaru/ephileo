/**
 * Slash command registry — extensible system for `/command` handling in the REPL.
 *
 * Each command registers a name, description, and async handler.
 * The REPL dispatches `/foo` input to the matching handler.
 * Unknown commands are reported with a list of available commands.
 */

import { DIM, GREEN, RED, RESET, YELLOW } from "./ansi.js";

/** Result of running a slash command. */
export interface CommandResult {
  /** If true, the REPL should skip sending this input to the LLM. */
  handled: boolean;
  /** Optional message to display to the user. */
  message?: string;
}

/** Handler function for a slash command. Receives the part after the command name (trimmed). */
export type CommandHandler = (args: string) => Promise<CommandResult>;

interface CommandRegistration {
  name: string;
  description: string;
  handler: CommandHandler;
}

export class CommandRegistry {
  private commands = new Map<string, CommandRegistration>();

  register(name: string, description: string, handler: CommandHandler): void {
    this.commands.set(name, { name, description, handler });
  }

  /** Try to handle a slash command. Returns null if the input is not a slash command. */
  async dispatch(input: string): Promise<CommandResult | null> {
    if (!input.startsWith("/")) return null;

    const spaceIdx = input.indexOf(" ");
    const name = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

    const cmd = this.commands.get(name);
    if (!cmd) {
      return {
        handled: true,
        message: this.formatUnknownCommand(name),
      };
    }

    return cmd.handler(args);
  }

  private formatUnknownCommand(name: string): string {
    const lines = [`${RED}Unknown command: /${name}${RESET}`];
    if (this.commands.size > 0) {
      lines.push(`${DIM}Available commands:${RESET}`);
      for (const cmd of this.commands.values()) {
        lines.push(`  ${GREEN}/${cmd.name}${RESET} ${DIM}— ${cmd.description}${RESET}`);
      }
    }
    return lines.join("\n");
  }

  /** Return all registered commands as completion items for autocomplete. */
  getCompletions(): Array<{ name: string; description: string }> {
    const items: Array<{ name: string; description: string }> = [];
    for (const cmd of this.commands.values()) {
      items.push({ name: cmd.name, description: cmd.description });
    }
    return items;
  }

  /** Format a help listing of all registered commands. */
  formatHelp(): string {
    if (this.commands.size === 0) return `${DIM}No commands available.${RESET}`;
    const lines = [`${YELLOW}Available commands:${RESET}`];
    for (const cmd of this.commands.values()) {
      lines.push(`  ${GREEN}/${cmd.name}${RESET} ${DIM}— ${cmd.description}${RESET}`);
    }
    return lines.join("\n");
  }
}
