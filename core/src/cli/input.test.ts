import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  isBackspace,
  isCtrlC,
  isCtrlD,
  isOtherEscapeSequence,
  isPlainEnter,
  isShiftEnter,
  readMultiLineInput,
  redrawCurrentLine,
} from "./input.js";

// ---------------------------------------------------------------------------
// Key classification unit tests
// ---------------------------------------------------------------------------

describe("isShiftEnter", () => {
  it("recognizes kitty keyboard protocol sequence", () => {
    expect(isShiftEnter(Buffer.from("\x1b[13;2u"))).toBe(true);
  });

  it("recognizes ESC + carriage return", () => {
    expect(isShiftEnter(Buffer.from([0x1b, 0x0d]))).toBe(true);
  });

  it("recognizes ESC + newline", () => {
    expect(isShiftEnter(Buffer.from([0x1b, 0x0a]))).toBe(true);
  });

  it("rejects plain Enter", () => {
    expect(isShiftEnter(Buffer.from([0x0d]))).toBe(false);
  });

  it("rejects other escape sequences", () => {
    expect(isShiftEnter(Buffer.from("\x1b[A"))).toBe(false);
  });
});

describe("isPlainEnter", () => {
  it("recognizes carriage return", () => {
    expect(isPlainEnter(Buffer.from([0x0d]))).toBe(true);
  });

  it("recognizes newline", () => {
    expect(isPlainEnter(Buffer.from([0x0a]))).toBe(true);
  });

  it("rejects multi-byte sequences", () => {
    expect(isPlainEnter(Buffer.from([0x0d, 0x0a]))).toBe(false);
  });
});

describe("isBackspace", () => {
  it("recognizes DEL byte (127)", () => {
    expect(isBackspace(Buffer.from([0x7f]))).toBe(true);
  });

  it("rejects regular characters", () => {
    expect(isBackspace(Buffer.from("a"))).toBe(false);
  });
});

describe("isCtrlC", () => {
  it("recognizes byte 3", () => {
    expect(isCtrlC(Buffer.from([0x03]))).toBe(true);
  });

  it("rejects other control bytes", () => {
    expect(isCtrlC(Buffer.from([0x04]))).toBe(false);
  });
});

describe("isCtrlD", () => {
  it("recognizes byte 4", () => {
    expect(isCtrlD(Buffer.from([0x04]))).toBe(true);
  });

  it("rejects byte 3", () => {
    expect(isCtrlD(Buffer.from([0x03]))).toBe(false);
  });
});

describe("isOtherEscapeSequence", () => {
  it("recognizes arrow key up", () => {
    expect(isOtherEscapeSequence(Buffer.from("\x1b[A"))).toBe(true);
  });

  it("does not match Shift+Enter (kitty)", () => {
    expect(isOtherEscapeSequence(Buffer.from("\x1b[13;2u"))).toBe(false);
  });

  it("does not match single bytes", () => {
    expect(isOtherEscapeSequence(Buffer.from([0x1b]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// redrawCurrentLine
// ---------------------------------------------------------------------------

describe("redrawCurrentLine", () => {
  it("writes clear-line then prompt and content", () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf-8")));

    redrawCurrentLine(output, "> ", "hello");

    const written = chunks.join("");
    expect(written).toContain("> hello");
    // Should contain the clear-line sequence
    expect(written).toContain("\x1b[2K");
  });
});

// ---------------------------------------------------------------------------
// readMultiLineInput integration-style tests
// ---------------------------------------------------------------------------

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

    // Type "hello" then press Enter
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

    // Type "line1", Shift+Enter, "line2", Enter
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

  it("handles backspace within a single line", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    // Type "helo" -> backspace -> "lo" -> Enter => "helo" without last char = "hel" + "lo"
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

    // Type "abc", Shift+Enter, backspace (empty second line -> join), Enter
    input.write(Buffer.from("abc"));
    input.write(Buffer.from("\x1b[13;2u"));
    // Second line is empty, backspace should join back to first line
    input.write(Buffer.from([0x7f]));
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

    // Press Ctrl+D immediately (empty buffer)
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

    // Type "text", Ctrl+D (ignored because buffer not empty), Enter
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

  it("ignores unrecognized escape sequences like arrow keys", async () => {
    const input = createMockInput();
    const output = new PassThrough();

    const resultPromise = readMultiLineInput({
      prompt: "> ",
      continuationPrompt: ".. ",
      input,
      output,
    });

    // Type "ab", arrow up (ignored), "c", Enter
    input.write(Buffer.from("ab"));
    input.write(Buffer.from("\x1b[A")); // arrow up — ignored
    input.write(Buffer.from("c"));
    input.write(Buffer.from([0x0d]));

    const result = await resultPromise;
    expect(result).toEqual({ kind: "input", value: "abc" });
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

    // Raw mode should be enabled
    expect(input.setRawMode).toHaveBeenCalledWith(true);

    input.write(Buffer.from([0x0d]));
    await resultPromise;

    // Raw mode should be disabled on cleanup
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
});
