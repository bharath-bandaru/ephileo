/**
 * LLM Client - talks to any OpenAI-compatible API (exo, ollama, vLLM, etc.)
 *
 * Lowest layer. Knows nothing about agents or tools.
 * Just sends messages, gets back a response.
 *
 * Supports streaming: tokens arrive one at a time, and a callback
 * lets the caller display them live as they arrive.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCallMessage[];
  tool_call_id?: string;
}

export interface ToolCallMessage {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  thinking: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface LLMClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens: number;
}

/** Callback for live token display. isThinking=true when inside <think> block. */
export type OnTokenCallback = (token: string, isThinking: boolean) => void;

export class LLMClient {
  readonly opts: LLMClientOptions;

  constructor(opts: LLMClientOptions) {
    this.opts = opts;
  }

  /**
   * Streaming chat completion.
   *
   * Tokens arrive one at a time via SSE. The onToken callback fires for each
   * token so you can display them live in the terminal. At the end, the full
   * parsed LLMResponse is returned (same shape as before).
   */
  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    onToken?: OnTokenCallback,
  ): Promise<LLMResponse> {
    const payload: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      max_tokens: this.opts.maxTokens,
      stream: true,
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) {
      headers["Authorization"] = `Bearer ${this.opts.apiKey}`;
    }

    const resp = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`LLM request failed (${resp.status}): ${body}`);
    }

    // Parse the SSE stream
    let fullContent = "";
    let finishReason = "stop";
    // Accumulate tool call deltas: index -> { id, name, arguments }
    const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();
    // Track whether we're inside a <think> block for live display
    let insideThink = false;
    let thinkTagBuffer = ""; // buffer for detecting partial <think> or </think> tags

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop()!; // keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Accumulate finish reason
        if (chunk.choices[0].finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }

        // Handle content tokens
        if (delta.content) {
          fullContent += delta.content;

          if (onToken) {
            // Stream each token through think-block detection
            thinkTagBuffer += delta.content;
            // Process the buffer, emitting tokens with correct isThinking state
            this.processThinkBuffer(thinkTagBuffer, insideThink, onToken, (newInside, remaining) => {
              insideThink = newInside;
              thinkTagBuffer = remaining;
            });
          }
        }

        // Handle tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccum.has(idx)) {
              toolCallAccum.set(idx, { id: "", name: "", arguments: "" });
            }
            const accum = toolCallAccum.get(idx)!;
            if (tc.id) accum.id = tc.id;
            if (tc.function?.name) accum.name += tc.function.name;
            if (tc.function?.arguments) accum.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Flush any remaining think buffer
    if (onToken && thinkTagBuffer) {
      onToken(thinkTagBuffer, insideThink);
    }

    // Parse accumulated tool calls
    const toolCalls: ToolCall[] = [];
    for (const [, tc] of [...toolCallAccum.entries()].sort((a, b) => a[0] - b[0])) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        // partial or malformed args
      }
      toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
    }

    // Extract thinking from full content
    let thinking: string | null = null;
    let content = fullContent;
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }

    return {
      content: content || null,
      thinking,
      toolCalls,
      finishReason,
    };
  }

  /**
   * Process the think-tag buffer, emitting tokens with correct isThinking state.
   * Detects <think> and </think> tags even when split across chunks.
   */
  private processThinkBuffer(
    buffer: string,
    insideThink: boolean,
    onToken: OnTokenCallback,
    update: (newInside: boolean, remaining: string) => void,
  ): void {
    let pos = 0;
    let inside = insideThink;

    while (pos < buffer.length) {
      if (!inside) {
        // Look for <think>
        const openIdx = buffer.indexOf("<think>", pos);
        if (openIdx === -1) {
          // Check if buffer ends with a partial "<think>" match
          const partialCheck = "<think>";
          for (let i = 1; i < partialCheck.length; i++) {
            if (buffer.endsWith(partialCheck.slice(0, i))) {
              // Emit everything before the partial match, keep partial in buffer
              const safe = buffer.slice(pos, buffer.length - i);
              if (safe) onToken(safe, false);
              update(inside, buffer.slice(buffer.length - i));
              return;
            }
          }
          // No partial match, emit everything
          if (pos < buffer.length) onToken(buffer.slice(pos), false);
          update(inside, "");
          return;
        }
        // Emit text before <think>
        if (openIdx > pos) onToken(buffer.slice(pos, openIdx), false);
        inside = true;
        pos = openIdx + 7; // skip past "<think>"
        onToken("[thinking] ", false); // visual marker
      } else {
        // Look for </think>
        const closeIdx = buffer.indexOf("</think>", pos);
        if (closeIdx === -1) {
          // Check for partial "</think>" at end
          const partialCheck = "</think>";
          for (let i = 1; i < partialCheck.length; i++) {
            if (buffer.endsWith(partialCheck.slice(0, i))) {
              const safe = buffer.slice(pos, buffer.length - i);
              if (safe) onToken(safe, true);
              update(inside, buffer.slice(buffer.length - i));
              return;
            }
          }
          // Emit thinking content
          if (pos < buffer.length) onToken(buffer.slice(pos), true);
          update(inside, "");
          return;
        }
        // Emit thinking content before </think>
        if (closeIdx > pos) onToken(buffer.slice(pos, closeIdx), true);
        onToken("\n", true); // end thinking line
        inside = false;
        pos = closeIdx + 8; // skip past "</think>"
      }
    }

    update(inside, "");
  }
}
