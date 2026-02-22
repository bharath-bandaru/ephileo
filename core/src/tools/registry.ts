/**
 * Tool Registry — defines what actions the agent can take.
 *
 * Each tool has:
 *   1. A schema (JSON Schema) — tells the LLM what the tool does and what args it expects
 *   2. A handler function — actually executes the tool when called
 *
 * To add a new tool: call registry.register({ name, description, parameters, handler })
 */

import type { ToolDefinition } from "../llm/index.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
  requiresConfirmation?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  register(tool: ToolRegistration): void {
    this.tools.set(tool.name, tool);
  }

  /** Get all tool schemas in OpenAI format (sent to the LLM). */
  getSchemas(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /** Execute a tool by name. Returns result string. */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: unknown tool '${name}'`;
    }
    try {
      return await tool.handler(args);
    } catch (err) {
      return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
