import { describe, expect, it } from "vitest";
import { applyEdit } from "./edit.js";

describe("applyEdit", () => {
  it("replaces a single matching occurrence", () => {
    const result = applyEdit({
      content: "Hello world",
      oldString: "world",
      newString: "TypeScript",
    });

    expect(result).toEqual({ ok: true, content: "Hello TypeScript", replacements: 1 });
  });

  it("returns error when old_string is not found", () => {
    const result = applyEdit({
      content: "Hello world",
      oldString: "missing",
      newString: "anything",
    });

    expect(result).toEqual({ ok: false, error: "old_string not found in file" });
  });

  it("returns error when there are multiple matches and replace_all is false", () => {
    const result = applyEdit({
      content: "foo bar foo",
      oldString: "foo",
      newString: "baz",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("2");
      expect(result.error).toContain("replace_all");
    }
  });

  it("returns error when there are multiple matches and replace_all is undefined", () => {
    const result = applyEdit({
      content: "abc abc abc",
      oldString: "abc",
      newString: "xyz",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("3");
    }
  });

  it("replaces all occurrences when replace_all is true", () => {
    const result = applyEdit({
      content: "foo bar foo baz foo",
      oldString: "foo",
      newString: "qux",
      replaceAll: true,
    });

    expect(result).toEqual({
      ok: true,
      content: "qux bar qux baz qux",
      replacements: 3,
    });
  });

  it("returns error when old_string and new_string are identical", () => {
    const result = applyEdit({
      content: "Hello world",
      oldString: "world",
      newString: "world",
    });

    expect(result).toEqual({
      ok: false,
      error: "old_string and new_string are identical",
    });
  });

  it("returns error when old_string is empty", () => {
    const result = applyEdit({
      content: "Hello world",
      oldString: "",
      newString: "something",
    });

    expect(result).toEqual({ ok: false, error: "old_string must not be empty" });
  });

  it("handles multiline old_string and new_string", () => {
    const content = "line one\nline two\nline three";
    const result = applyEdit({
      content,
      oldString: "line one\nline two",
      newString: "line A\nline B",
    });

    expect(result).toEqual({
      ok: true,
      content: "line A\nline B\nline three",
      replacements: 1,
    });
  });

  it("preserves surrounding content unchanged", () => {
    const content = "PREFIX__TARGET__SUFFIX";
    const result = applyEdit({
      content,
      oldString: "TARGET",
      newString: "REPLACEMENT",
    });

    expect(result).toEqual({
      ok: true,
      content: "PREFIX__REPLACEMENT__SUFFIX",
      replacements: 1,
    });
  });

  it("treats old_string as a literal — special regex chars are matched literally", () => {
    // Characters like $, ., *, (, ), [, ] are regex-special but must work literally.
    const content = "price is $10.00 (plus tax)";
    const result = applyEdit({
      content,
      oldString: "$10.00 (plus tax)",
      newString: "$12.00 (plus tax)",
    });

    expect(result).toEqual({
      ok: true,
      content: "price is $12.00 (plus tax)",
      replacements: 1,
    });
  });

  it("returns correct replacement count for replace_all", () => {
    const result = applyEdit({
      content: "a a a a a",
      oldString: "a",
      newString: "b",
      replaceAll: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replacements).toBe(5);
      expect(result.content).toBe("b b b b b");
    }
  });

  it("replaces with empty new_string (deletion)", () => {
    const result = applyEdit({
      content: "Hello [REMOVE THIS] world",
      oldString: " [REMOVE THIS]",
      newString: "",
    });

    expect(result).toEqual({
      ok: true,
      content: "Hello world",
      replacements: 1,
    });
  });
});
