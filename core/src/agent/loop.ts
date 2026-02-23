/**
 * Agent Loop — the core of Ephileo.
 *
 * This is the heart of the system. The loop:
 * 1. Takes user input + conversation history
 * 2. Sends to LLM with available tool definitions
 * 3. If LLM wants to call a tool → execute it → feed result back → repeat
 * 4. If LLM gives a final text response → return it
 *
 * The loop is stateless and pure — it takes inputs and returns outputs.
 * The caller (CLI, daemon, API) manages state/persistence.
 */

import { UserAbortError } from "../errors.js";
import type { ChatMessage, LLMClient, OnTokenCallback } from "../llm/index.js";
import type { ToolRegistry } from "../tools/index.js";

const MAX_TURNS = 20;
const TOOL_ARGS_PREVIEW_LENGTH = 80;

export interface AgentResult {
  response: string;
  turns: number;
  toolsUsed: string[];
}

export type LogFn = (message: string) => void;

export async function runAgentLoop(
  messages: ChatMessage[],
  llm: LLMClient,
  tools: ToolRegistry,
  log: LogFn = () => {},
  onToken?: OnTokenCallback,
  maxTurns: number = MAX_TURNS,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const schemas = tools.getSchemas();
  const toolsUsed: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    log(`[turn ${turn + 1}]`);
    const response = await llm.chat(messages, schemas, onToken, signal);

    // No tool calls = final answer
    if (response.toolCalls.length === 0) {
      return {
        response: response.content || "(no response)",
        turns: turn + 1,
        toolsUsed,
      };
    }

    // Build the assistant message with tool calls
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: response.content || "",
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
    messages.push(assistantMsg);

    // Execute each tool call and add results
    for (const tc of response.toolCalls) {
      if (signal?.aborted) throw new UserAbortError();
      const argsPreview = JSON.stringify(tc.arguments).slice(0, TOOL_ARGS_PREVIEW_LENGTH);
      log(`[tool] ${tc.name}(${argsPreview})`);
      toolsUsed.push(tc.name);

      const result = await tools.execute(tc.name, tc.arguments);

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  return {
    response: "(max turns reached — stopped for safety)",
    turns: maxTurns,
    toolsUsed,
  };
}
