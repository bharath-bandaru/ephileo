import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendHistory, decodeLine, encodeLine, loadHistory } from "./history.js";

// Create a temp dir for each test file write
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "ephileo-hist-"));
  return join(dir, "history");
}

describe("encodeLine / decodeLine", () => {
  it("round-trips a simple string", () => {
    const input = "hello world";
    expect(decodeLine(encodeLine(input))).toBe(input);
  });

  it("round-trips a multi-line string", () => {
    const input = "line1\nline2\nline3";
    const encoded = encodeLine(input);
    expect(encoded).not.toContain("\n");
    expect(decodeLine(encoded)).toBe(input);
  });

  it("round-trips backslashes", () => {
    const input = "path\\to\\file";
    expect(decodeLine(encodeLine(input))).toBe(input);
  });

  it("round-trips mixed backslashes and newlines", () => {
    const input = "a\\b\nc\\d";
    expect(decodeLine(encodeLine(input))).toBe(input);
  });

  it("handles empty string", () => {
    expect(decodeLine(encodeLine(""))).toBe("");
  });
});

describe("loadHistory", () => {
  it("returns empty array for non-existent file", () => {
    expect(loadHistory("/tmp/ephileo-does-not-exist-12345")).toEqual([]);
  });

  it("loads entries from a file", () => {
    const f = tempFile();
    writeFileSync(f, "hello\nworld\n", "utf-8");
    expect(loadHistory(f)).toEqual(["hello", "world"]);
  });

  it("skips empty lines", () => {
    const f = tempFile();
    writeFileSync(f, "a\n\nb\n\n", "utf-8");
    expect(loadHistory(f)).toEqual(["a", "b"]);
  });

  it("decodes escaped newlines", () => {
    const f = tempFile();
    writeFileSync(f, "line1\\nline2\n", "utf-8");
    expect(loadHistory(f)).toEqual(["line1\nline2"]);
  });
});

describe("appendHistory", () => {
  let file: string;
  afterEach(() => {
    // no explicit cleanup needed — OS cleans temp
  });

  it("creates file and appends an entry", () => {
    file = tempFile();
    appendHistory(file, "first command");
    const content = readFileSync(file, "utf-8");
    expect(content).toBe("first command\n");
  });

  it("appends multiple entries", () => {
    file = tempFile();
    appendHistory(file, "cmd1");
    appendHistory(file, "cmd2");
    const entries = loadHistory(file);
    expect(entries).toEqual(["cmd1", "cmd2"]);
  });

  it("encodes multi-line entries", () => {
    file = tempFile();
    appendHistory(file, "line1\nline2");
    const raw = readFileSync(file, "utf-8");
    expect(raw).not.toContain("\nline2"); // should be escaped
    const entries = loadHistory(file);
    expect(entries).toEqual(["line1\nline2"]);
  });

  it("silently ignores write failures", () => {
    // Writing to a directory path should fail silently
    expect(() => appendHistory("/dev/null/impossible", "test")).not.toThrow();
  });
});
