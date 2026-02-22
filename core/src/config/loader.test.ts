import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the loader
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import { existsSync, readFileSync } from "node:fs";
import { _resetConfigCacheForTesting, getActiveProvider, loadConfig } from "./loader.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const VALID_YAML = `
provider: exo
providers:
  exo:
    baseUrl: http://localhost:52415/v1
    model: test-model
`;

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetConfigCacheForTesting();
    mockedExistsSync.mockReturnValue(false);
    // Clear ephileo env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("EPHILEO_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when config file is missing", () => {
    mockedExistsSync.mockReturnValue(false);
    expect(() => loadConfig()).toThrow("Config file not found");
  });

  it("throws when provider is missing from config", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
providers:
  exo:
    baseUrl: http://localhost:52415/v1
    model: test
`);
    expect(() => loadConfig()).toThrow("Missing 'provider'");
  });

  it("throws when no providers are configured", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("provider: exo\n");
    expect(() => loadConfig()).toThrow("No providers configured");
  });

  it("loads config from yaml file", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(`
provider: ollama
providers:
  ollama:
    baseUrl: http://localhost:11434/v1
    model: llama3
`);

    const config = loadConfig();
    expect(config.provider).toBe("ollama");
    expect(config.providers.ollama.model).toBe("llama3");
    // No default exo provider — only what's in the file
    expect(config.providers.exo).toBeUndefined();
  });

  it("applies environment variable overrides", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(VALID_YAML);

    process.env.EPHILEO_PROVIDER = "custom";
    process.env.EPHILEO_BASE_URL = "http://custom:8000/v1";
    process.env.EPHILEO_MODEL = "test-model";

    const config = loadConfig();
    expect(config.provider).toBe("custom");
    expect(config.providers.custom.baseUrl).toBe("http://custom:8000/v1");
    expect(config.providers.custom.model).toBe("test-model");
  });

  it("uses agent defaults when not specified in yaml", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(VALID_YAML);

    const config = loadConfig();
    expect(config.agent.maxTurns).toBe(20);
    expect(config.agent.maxTokens).toBe(4096);
  });

  it("resolves relative memory dir to absolute path", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(VALID_YAML);

    const config = loadConfig();
    expect(config.memory.dir).toMatch(/^\//);
    expect(config.memory.dir).toContain("memory");
  });
});

describe("getActiveProvider", () => {
  beforeEach(() => {
    _resetConfigCacheForTesting();
  });

  it("returns the active provider config", () => {
    const config = {
      provider: "exo",
      providers: {
        exo: { baseUrl: "http://localhost:52415/v1", model: "test" },
      },
      agent: { maxTurns: 20, maxTokens: 4096 },
      memory: { dir: "/tmp/memory" },
    };

    const provider = getActiveProvider(config);
    expect(provider.baseUrl).toBe("http://localhost:52415/v1");
    expect(provider.model).toBe("test");
  });

  it("throws for unknown provider", () => {
    const config = {
      provider: "nonexistent",
      providers: {
        exo: { baseUrl: "http://localhost:52415/v1", model: "test" },
      },
      agent: { maxTurns: 20, maxTokens: 4096 },
      memory: { dir: "/tmp/memory" },
    };

    expect(() => getActiveProvider(config)).toThrow("nonexistent");
    expect(() => getActiveProvider(config)).toThrow("exo");
  });
});
