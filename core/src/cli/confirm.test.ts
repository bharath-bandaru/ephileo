import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { askConfirmation, formatToolPreview, readYesNo } from "./confirm.js";

// --- Helpers ---------------------------------------------------------------

type MockInput = PassThrough & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
};

function createMockInput(isTTY = true, isRaw = false): MockInput {
  const stream = new PassThrough() as MockInput;
  stream.isTTY = isTTY;
  stream.isRaw = isRaw;
  stream.setRawMode = () => {};
  return stream;
}

function collectOutput(stream: PassThrough): string {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return chunks.map((c) => c.toString("utf-8")).join("");
}

// ---------------------------------------------------------------------------
// formatToolPreview — pure function, no I/O
// ---------------------------------------------------------------------------

describe("formatToolPreview", () => {
  it("write_file shows path and content in green", () => {
    const preview = formatToolPreview("write_file", {
      path: "/tmp/hello.ts",
      content: "const x = 1;",
    });
    expect(preview).toContain("/tmp/hello.ts");
    expect(preview).toContain("const x = 1;");
    // Should include green ANSI for content
    expect(preview).toContain("\x1b[32m");
  });

  it("edit_file shows path, old in red, new in green", () => {
    const preview = formatToolPreview("edit_file", {
      path: "/tmp/foo.ts",
      old_string: "old code",
      new_string: "new code",
    });
    expect(preview).toContain("/tmp/foo.ts");
    // Old string with red prefix
    expect(preview).toContain("\x1b[31m- old code");
    // New string with green prefix
    expect(preview).toContain("\x1b[32m+ new code");
  });

  it("edit_file with replace_all mentions replace_all", () => {
    const preview = formatToolPreview("edit_file", {
      path: "/tmp/foo.ts",
      old_string: "foo",
      new_string: "bar",
      replace_all: true,
    });
    expect(preview).toContain("replace_all");
  });

  it("shell shows command in yellow", () => {
    const preview = formatToolPreview("shell", { command: "ls -la" });
    expect(preview).toContain("ls -la");
    expect(preview).toContain("\x1b[33m");
  });

  it("unknown tool shows tool name and JSON args", () => {
    const preview = formatToolPreview("custom_tool", { key: "value" });
    expect(preview).toContain("custom_tool");
    expect(preview).toContain('"key"');
    expect(preview).toContain('"value"');
  });

  it("long write_file content is truncated with indicator", () => {
    const manyLines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const preview = formatToolPreview("write_file", { path: "/tmp/big.txt", content: manyLines });
    expect(preview).toContain("more lines");
    // Should NOT contain line 60 (beyond the 50-line limit)
    expect(preview).not.toContain("line 60");
    // Should contain line 50 (the last displayed line)
    expect(preview).toContain("line 50");
  });

  it("empty write_file content is handled without error", () => {
    const preview = formatToolPreview("write_file", { path: "/tmp/empty.txt", content: "" });
    expect(preview).toContain("/tmp/empty.txt");
    expect(typeof preview).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// readYesNo
// ---------------------------------------------------------------------------

describe("readYesNo", () => {
  it("'y' returns true", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    input.write(Buffer.from([121])); // 'y'
    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("'Y' returns true", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    input.write(Buffer.from([89])); // 'Y'
    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("'n' returns false", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    input.write(Buffer.from([110])); // 'n'
    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("'N' returns false", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    input.write(Buffer.from([78])); // 'N'
    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("Escape (0x1b) returns false", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    input.write(Buffer.from([0x1b])); // Escape
    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("ignores non-y/n keys then accepts 'y'", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const resultPromise = readYesNo({ input, output });
    // Send some ignored keys first
    input.write(Buffer.from([65])); // 'A' — ignored
    input.write(Buffer.from([32])); // space — ignored
    input.write(Buffer.from([121])); // 'y' — accepted
    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("auto-approves and writes warning when input is not a TTY", async () => {
    const input = createMockInput(false); // isTTY = false
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf-8")));

    const result = await readYesNo({ input, output });
    expect(result).toBe(true);
    const written = chunks.join("");
    expect(written).toContain("auto-approv");
  });
});

// ---------------------------------------------------------------------------
// askConfirmation
// ---------------------------------------------------------------------------

describe("askConfirmation", () => {
  it("writes preview to output and returns result from readYesNo", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf-8")));

    const resultPromise = askConfirmation("shell", { command: "echo hi" }, { input, output });
    input.write(Buffer.from([121])); // 'y'

    const result = await resultPromise;
    expect(result).toBe(true);

    const written = chunks.join("");
    expect(written).toContain("echo hi");
    expect(written).toContain("shell");
  });

  it("returns false when user denies", async () => {
    const input = createMockInput();
    const output = new PassThrough();
    // Drain output so it doesn't block
    output.resume();

    const resultPromise = askConfirmation("shell", { command: "rm -rf /" }, { input, output });
    input.write(Buffer.from([110])); // 'n'

    const result = await resultPromise;
    expect(result).toBe(false);
  });
});

// Ensure collectOutput is used (it's used in describe blocks above via closure)
void collectOutput;
