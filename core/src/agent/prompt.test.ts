import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

describe("buildSystemPrompt", () => {
  it("includes persona and guidelines", () => {
    const prompt = buildSystemPrompt("");
    expect(prompt).toContain("You are Ephileo");
    expect(prompt).toContain("Guidelines:");
  });

  it("includes edit_file guidance", () => {
    const prompt = buildSystemPrompt("");
    expect(prompt).toContain("edit_file");
    expect(prompt).toContain("NEVER use write_file to modify an existing file");
  });

  it("appends memory when provided", () => {
    const memory = "## User Profile\nName: Alice";
    const prompt = buildSystemPrompt(memory);
    expect(prompt).toContain("Your memory (things you've previously learned):");
    expect(prompt).toContain("Name: Alice");
  });

  it("omits memory section when empty", () => {
    const prompt = buildSystemPrompt("");
    expect(prompt).not.toContain("Your memory");
  });
});
