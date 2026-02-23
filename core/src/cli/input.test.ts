import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readMultiLineInput, visualLength } from "./input.js";

/** Create a fake TTY-like PassThrough stream. */
function createMockInput(): PassThrough & { isTTY: boolean; setRawMode: ReturnType<typeof vi.fn> } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
  };
  stream.isTTY = true;
  stream.setRawMode = vi.fn();
  return stream;
}

describe("readMultiLineInput", () => {
  it("submits single-line input on Enter", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("hello"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "hello" });
  });

  it("inserts newline on Shift+Enter (kitty) and submits on Enter", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("line1"));
    input.write(Buffer.from("\x1b[13;2u"));
    input.write(Buffer.from("line2"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "line1\nline2" });
  });

  it("inserts newline on ESC+CR (Alt+Enter) and submits on Enter", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("first"));
    input.write(Buffer.from([0x1b, 0x0d]));
    input.write(Buffer.from("second"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "first\nsecond" });
  });

  it("inserts newline on backslash+Enter continuation", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("hello\\"));
    input.write(Buffer.from([0x0d])); // backslash+Enter → continuation
    input.write(Buffer.from("world"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "hello\nworld" });
  });

  it("handles backspace within a single line", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("helo"));
    input.write(Buffer.from([0x7f])); // backspace: "hel"
    input.write(Buffer.from("lo"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "hello" });
  });

  it("handles backspace that joins lines", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("abc"));
    input.write(Buffer.from("\x1b[13;2u"));
    input.write(Buffer.from([0x7f])); // backspace on empty second line
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "abc" });
  });

  it("returns EOF on Ctrl+D with empty buffer", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from([0x04]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "eof" });
  });

  it("ignores Ctrl+D when buffer is non-empty", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("text"));
    input.write(Buffer.from([0x04]));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "text" });
  });

  it("submits empty string on immediate Enter", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "" });
  });

  it("enables and disables raw mode on TTY streams", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    expect(input.setRawMode).toHaveBeenCalledWith(true);

    input.write(Buffer.from([0x0d]));
    await resultPromise;

    expect(input.setRawMode).toHaveBeenCalledWith(false);
  });

  it("supports multiple Shift+Enter continuations", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("a"));
    input.write(Buffer.from("\x1b[13;2u"));
    input.write(Buffer.from("b"));
    input.write(Buffer.from("\x1b[13;2u"));
    input.write(Buffer.from("c"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "a\nb\nc" });
  });

  it("inserts characters at cursor position after left arrow", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    // Type "ac", left arrow, "b" → "abc"
    input.write(Buffer.from("ac"));
    input.write(Buffer.from("\x1b[D")); // left
    input.write(Buffer.from("b"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "abc" });
  });

  it("navigates history with up/down arrows", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      history: ["first", "second"],
      input,
      output,
    });

    // Press up twice to get "first", then Enter
    input.write(Buffer.from("\x1b[A")); // up → "second"
    input.write(Buffer.from("\x1b[A")); // up → "first"
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "first" });
  });

  it("preserves draft when navigating history and returning", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      history: ["old"],
      input,
      output,
    });

    // Type "draft", up (to "old"), down (back to "draft"), Enter
    input.write(Buffer.from("draft"));
    input.write(Buffer.from("\x1b[A")); // up → "old"
    input.write(Buffer.from("\x1b[B")); // down → "draft"
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "draft" });
  });

  it("ignores unrecognized escape sequences", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    input.write(Buffer.from("ab"));
    input.write(Buffer.from("\x1bOP")); // F1 key — ignored
    input.write(Buffer.from("c"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "abc" });
  });

  it("handles backspace at cursor mid-line", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    // Type "abcd", left twice (cursor at 'c'), backspace deletes 'b' → "acd"
    input.write(Buffer.from("abcd"));
    input.write(Buffer.from("\x1b[D")); // left → col 3
    input.write(Buffer.from("\x1b[D")); // left → col 2
    input.write(Buffer.from([0x7f])); // backspace at col 2 → deletes 'b'
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "acd" });
  });

  it("arrow up at boundary with no history does not emit ANSI cursor move", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      history: [],
      input,
      output,
    });

    // Type "text", then press Up (at row 0, no history) — should not move cursor up
    input.write(Buffer.from("text"));
    input.write(Buffer.from("\x1b[A")); // up — should be a no-op at boundary

    // Collect output so far, then submit
    input.write(Buffer.from([0x0d]));
    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "text" });

    // Verify that no ANSI move-up sequence (\x1b[A) was written to output
    // after the Up arrow was pressed (the prompt itself is written before we type)
    const allOutput = Buffer.concat(chunks).toString("utf-8");
    // The initial prompt write is before typing; any move-up in response to
    // the arrow key would appear after the prompt. We can confirm the cursor
    // escape we wrote for the arrow key is not present by checking only the
    // output written AFTER the initial prompt — but the simplest check is that
    // the total number of ANSI move-up sequences equals those used for legitimate
    // redraws (zero in a single-line, no-history scenario).
    const moveUpSequence = "\x1b[A";
    // Strip the initial prompt from consideration by counting only occurrences
    // that appear after at least one character of content was written
    const contentStart = allOutput.indexOf("text");
    const afterContent = contentStart >= 0 ? allOutput.slice(contentStart) : allOutput;
    expect(afterContent.includes(moveUpSequence)).toBe(false);
  });

  it("arrow down at boundary with no history does not emit ANSI cursor move", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      history: [],
      input,
      output,
    });

    // Type "text", press Down (at row 0 = last row, no history forward) — should be no-op
    input.write(Buffer.from("text"));
    input.write(Buffer.from("\x1b[B")); // down — should be a no-op at boundary
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "text" });

    const allOutput = Buffer.concat(chunks).toString("utf-8");
    const moveDownSequence = "\x1b[B";
    const contentStart = allOutput.indexOf("text");
    const afterContent = contentStart >= 0 ? allOutput.slice(contentStart) : allOutput;
    expect(afterContent.includes(moveDownSequence)).toBe(false);
  });

  it("arrow up within multi-line input moves cursor to previous row", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    // Type two lines, then navigate up and submit — value should still be correct
    input.write(Buffer.from("line1"));
    input.write(Buffer.from("\x1b[13;2u")); // Shift+Enter — creates second line
    input.write(Buffer.from("line2"));
    input.write(Buffer.from("\x1b[A")); // up — move to row 0 (within multi-line, not history)
    input.write(Buffer.from([0x0d])); // Enter from row 0 — submits whole buffer

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "line1\nline2" });
  });
});

describe("visualLength", () => {
  it("returns length of plain string unchanged", () => {
    expect(visualLength("hello")).toBe(5);
  });

  it("strips ANSI color reset sequence", () => {
    // "\x1b[0m" is 4 bytes but 0 visual characters
    expect(visualLength("\x1b[0m")).toBe(0);
  });

  it("strips ANSI color code and counts surrounding text", () => {
    // "\x1b[34m> \x1b[0m" — the prompt used in cli/index.ts
    // Visual content: "> " (2 chars), escapes have zero width
    expect(visualLength("\x1b[34m> \x1b[0m")).toBe(2);
  });

  it("strips bold sequence", () => {
    expect(visualLength("\x1b[1mBOLD\x1b[0m")).toBe(4);
  });

  it("strips multi-param sequence like dim", () => {
    expect(visualLength("\x1b[2mtext\x1b[0m")).toBe(4);
  });

  it("handles string with no escape sequences", () => {
    expect(visualLength("> ")).toBe(2);
    expect(visualLength(".. ")).toBe(3);
  });

  it("handles empty string", () => {
    expect(visualLength("")).toBe(0);
  });

  it("handles string that is only escape sequences", () => {
    expect(visualLength("\x1b[31m\x1b[0m")).toBe(0);
  });
});
