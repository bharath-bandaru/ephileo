import { describe, expect, it } from "vitest";
import type { OnTokenCallback } from "./client.js";
import { processThinkBuffer } from "./client.js";

/** Helper: run processThinkBuffer and collect all emitted tokens. */
function collectTokens(
  buffer: string,
  insideThink = false,
): {
  tokens: Array<{ text: string; isThinking: boolean }>;
  insideThink: boolean;
  remaining: string;
} {
  const tokens: Array<{ text: string; isThinking: boolean }> = [];
  let finalInside = insideThink;
  let finalRemaining = "";

  const onToken: OnTokenCallback = (text, isThinking) => {
    tokens.push({ text, isThinking });
  };

  processThinkBuffer(buffer, insideThink, onToken, (newInside, remaining) => {
    finalInside = newInside;
    finalRemaining = remaining;
  });

  return { tokens, insideThink: finalInside, remaining: finalRemaining };
}

describe("processThinkBuffer", () => {
  it("emits plain text with isThinking=false when no think tags", () => {
    const result = collectTokens("hello world");
    expect(result.tokens).toEqual([{ text: "hello world", isThinking: false }]);
    expect(result.insideThink).toBe(false);
    expect(result.remaining).toBe("");
  });

  it("detects <think> opening tag and transitions to thinking state", () => {
    const result = collectTokens("before<think>inside");

    // Should emit: "before" (not thinking), "[thinking] " marker, "inside" (thinking)
    expect(result.tokens[0]).toEqual({ text: "before", isThinking: false });
    expect(result.tokens[1]).toEqual({ text: "[thinking] ", isThinking: false });
    expect(result.tokens[2]).toEqual({ text: "inside", isThinking: true });
    expect(result.insideThink).toBe(true);
  });

  it("detects </think> closing tag and transitions back", () => {
    const result = collectTokens("content</think>after", true);

    // Should emit: "content" (thinking), newline (thinking), "after" (not thinking)
    expect(result.tokens[0]).toEqual({ text: "content", isThinking: true });
    expect(result.tokens[1]).toEqual({ text: "\n", isThinking: true });
    expect(result.tokens[2]).toEqual({ text: "after", isThinking: false });
    expect(result.insideThink).toBe(false);
  });

  it("handles a complete <think>...</think> block in one buffer", () => {
    const result = collectTokens("before<think>thought</think>after");

    const thinkingTokens = result.tokens.filter((t) => t.isThinking && t.text !== "\n");
    const plainTokens = result.tokens.filter((t) => !t.isThinking && t.text !== "[thinking] ");

    expect(plainTokens.map((t) => t.text)).toEqual(["before", "after"]);
    expect(thinkingTokens.map((t) => t.text)).toEqual(["thought"]);
    expect(result.insideThink).toBe(false);
  });

  it("buffers a partial <think> tag at the end", () => {
    const result = collectTokens("text<thi");

    // "text" should be emitted, "<thi" should be kept as remaining
    expect(result.tokens).toEqual([{ text: "text", isThinking: false }]);
    expect(result.remaining).toBe("<thi");
    expect(result.insideThink).toBe(false);
  });

  it("buffers a partial </think> tag at the end while thinking", () => {
    const result = collectTokens("thought</thi", true);

    expect(result.tokens).toEqual([{ text: "thought", isThinking: true }]);
    expect(result.remaining).toBe("</thi");
    expect(result.insideThink).toBe(true);
  });

  it("handles empty buffer", () => {
    const result = collectTokens("");
    expect(result.tokens).toEqual([]);
    expect(result.remaining).toBe("");
  });

  it("handles <think> tag at the very start", () => {
    const result = collectTokens("<think>inner");

    expect(result.tokens[0]).toEqual({ text: "[thinking] ", isThinking: false });
    expect(result.tokens[1]).toEqual({ text: "inner", isThinking: true });
    expect(result.insideThink).toBe(true);
  });
});
