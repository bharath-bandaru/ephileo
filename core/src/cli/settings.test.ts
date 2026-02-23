import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings.js";

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "ephileo-settings-"));
  return join(dir, "settings.json");
}

describe("loadSettings", () => {
  it("returns empty object for non-existent file", () => {
    const result = loadSettings("/tmp/nonexistent-ephileo-settings.json");
    expect(result).toEqual({});
  });

  it("loads permissionLevel from valid JSON", () => {
    const path = makeTempFile();
    writeFileSync(path, JSON.stringify({ permissionLevel: "auto-accept" }), "utf-8");
    const result = loadSettings(path);
    expect(result.permissionLevel).toBe("auto-accept");
  });

  it("ignores invalid permissionLevel value", () => {
    const path = makeTempFile();
    writeFileSync(path, JSON.stringify({ permissionLevel: "invalid-level" }), "utf-8");
    const result = loadSettings(path);
    expect(result.permissionLevel).toBeUndefined();
  });

  it("returns empty object for malformed JSON", () => {
    const path = makeTempFile();
    writeFileSync(path, "not json at all", "utf-8");
    const result = loadSettings(path);
    expect(result).toEqual({});
  });

  it("returns empty object for JSON array", () => {
    const path = makeTempFile();
    writeFileSync(path, "[1, 2, 3]", "utf-8");
    const result = loadSettings(path);
    expect(result).toEqual({});
  });

  it("ignores non-string permissionLevel", () => {
    const path = makeTempFile();
    writeFileSync(path, JSON.stringify({ permissionLevel: 42 }), "utf-8");
    const result = loadSettings(path);
    expect(result.permissionLevel).toBeUndefined();
  });
});

describe("saveSettings", () => {
  let tempPath: string;

  afterEach(() => {
    // cleanup handled by OS for temp files
  });

  it("writes settings to file", () => {
    tempPath = makeTempFile();
    saveSettings({ permissionLevel: "read-and-write" }, tempPath);
    const raw = readFileSync(tempPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.permissionLevel).toBe("read-and-write");
  });

  it("merges with existing settings", () => {
    tempPath = makeTempFile();
    writeFileSync(tempPath, JSON.stringify({ permissionLevel: "write-only" }), "utf-8");
    saveSettings({ permissionLevel: "auto-accept" }, tempPath);
    const raw = readFileSync(tempPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.permissionLevel).toBe("auto-accept");
  });

  it("creates file if it does not exist", () => {
    tempPath = makeTempFile();
    saveSettings({ permissionLevel: "write-only" }, tempPath);
    const raw = readFileSync(tempPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.permissionLevel).toBe("write-only");
  });
});
