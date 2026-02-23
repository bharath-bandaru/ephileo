import { describe, expect, it, vi } from "vitest";
import { UserAbortError } from "../errors.js";
import type { LLMResponse } from "../llm/index.js";
import { ToolRegistry } from "../tools/index.js";
import { runAgentLoop } from "./loop.js";

/** Create a minimal mock LLM client for testing. */
function makeMockLlm(responses: LLMResponse[]) {
  let callIdx = 0;
  return {
    opts: { baseUrl: "http://test", model: "test", maxTokens: 100 },
    chat: vi.fn(async () => {
      const resp = responses[callIdx];
      callIdx++;
      return resp;
    }),
  };
}

/** Create a registry with a simple echo tool. */
function makeToolRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "Echo tool",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    handler: async (args) => `echoed: ${String(args.text)}`,
  });
  return registry;
}

describe("runAgentLoop with abort signal", () => {
  it("propagates UserAbortError from llm.chat", async () => {
    const llm = {
      opts: { baseUrl: "http://test", model: "test", maxTokens: 100 },
      chat: vi.fn(async () => {
        throw new UserAbortError("cancelled during chat");
      }),
    };
    const tools = makeToolRegistry();
    const msgs = [{ role: "user" as const, content: "hello" }];

    await expect(runAgentLoop(msgs, llm as never, tools)).rejects.toThrow(UserAbortError);
  });

  it("checks signal.aborted before executing each tool", async () => {
    const controller = new AbortController();
    // LLM responds with a tool call
    const llm = makeMockLlm([
      {
        content: null,
        thinking: null,
        toolCalls: [{ id: "tc1", name: "echo", arguments: { text: "hi" } }],
        finishReason: "tool_calls",
      },
    ]);
    const tools = makeToolRegistry();
    const msgs = [{ role: "user" as const, content: "test" }];

    // Abort before the tool execution starts
    controller.abort();

    await expect(
      runAgentLoop(msgs, llm as never, tools, undefined, undefined, undefined, controller.signal),
    ).rejects.toThrow(UserAbortError);
  });

  it("completes normally when signal is provided but not aborted", async () => {
    const controller = new AbortController();
    const llm = makeMockLlm([
      {
        content: "Hello there!",
        thinking: null,
        toolCalls: [],
        finishReason: "stop",
      },
    ]);
    const tools = makeToolRegistry();
    const msgs = [{ role: "user" as const, content: "hi" }];

    const result = await runAgentLoop(
      msgs,
      llm as never,
      tools,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    expect(result.response).toBe("Hello there!");
    expect(result.turns).toBe(1);
  });

  it("passes signal to llm.chat", async () => {
    const controller = new AbortController();
    const llm = {
      opts: { baseUrl: "http://test", model: "test", maxTokens: 100 },
      chat: vi.fn(async () => ({
        content: "done",
        thinking: null,
        toolCalls: [],
        finishReason: "stop",
      })),
    };
    const tools = makeToolRegistry();
    const msgs = [{ role: "user" as const, content: "test" }];

    await runAgentLoop(
      msgs,
      llm as never,
      tools,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    // Verify signal was passed as the 4th argument to chat()
    const callArgs = llm.chat.mock.calls[0];
    expect(callArgs[3]).toBe(controller.signal);
  });
});
