/**
 * Tool Registry — defines what actions the agent can take.
 *
 * Each tool has:
 *   1. A schema (JSON Schema) — tells the LLM what the tool does and what args it expects
 *   2. A handler function — actually executes the tool when called
 *
 * To add a new tool: call registry.register({ name, description, parameters, handler })
 */

import { UserAbortError } from "../errors.js";
import type { ToolDefinition } from "../llm/index.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export type ConfirmationCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

/**
 * Which group a tool belongs to for permission gating.
 * - "read": tools that read from the filesystem or run non-destructive commands (read_file, list_directory, shell)
 * - "write": tools that modify the filesystem (write_file, edit_file)
 * - "none": tools that never need confirmation (save_learning)
 */
export type ConfirmationGroup = "read" | "write" | "none";

/**
 * Permission levels control which tool groups require user confirmation.
 * - "write-only": only write/edit tools need approval (default)
 * - "read-and-write": all tools need approval (including shell, read operations)
 * - "auto-accept": skip all confirmations
 */
export type PermissionLevel = "write-only" | "read-and-write" | "auto-accept";

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
  /** @deprecated Use confirmationGroup instead. Kept for backward compat. */
  requiresConfirmation?: boolean;
  /** Which permission group this tool belongs to. Defaults to "none". */
  confirmationGroup?: ConfirmationGroup;
}

const DENIAL_MESSAGE =
  "User declined to execute this tool. Adjust your approach or ask the user for guidance.";

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private confirmationCallback?: ConfirmationCallback;
  private permissionLevel: PermissionLevel = "write-only";

  register(tool: ToolRegistration): void {
    this.tools.set(tool.name, tool);
  }

  setConfirmationCallback(cb: ConfirmationCallback): void {
    this.confirmationCallback = cb;
  }

  setPermissionLevel(level: PermissionLevel): void {
    this.permissionLevel = level;
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
    if (this.shouldConfirm(tool) && this.confirmationCallback !== undefined) {
      try {
        const approved = await this.confirmationCallback(name, args);
        if (!approved) {
          return DENIAL_MESSAGE;
        }
      } catch (err) {
        if (err instanceof UserAbortError) throw err;
        return `Error during confirmation for ${name}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    try {
      return await tool.handler(args);
    } catch (err) {
      if (err instanceof UserAbortError) throw err;
      return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Determine if a tool should prompt for confirmation based on its group and the active permission level. */
  private shouldConfirm(tool: ToolRegistration): boolean {
    if (this.permissionLevel === "auto-accept") return false;
    const group = tool.confirmationGroup ?? (tool.requiresConfirmation ? "write" : "none");
    if (group === "none") return false;
    if (group === "write") return true;
    // group === "read": only confirm in "read-and-write" mode
    return this.permissionLevel === "read-and-write";
  }
}
