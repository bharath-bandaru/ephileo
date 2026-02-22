/**
 * Config loader — reads config.yaml, validates, and exports a typed object.
 *
 * Resolution order (highest priority wins):
 *   1. Environment variables (EPHILEO_PROVIDER, EPHILEO_BASE_URL, etc.)
 *   2. config.yaml (required — must define provider and at least one provider entry)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// --- Types ---

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface AgentConfig {
  maxTurns: number;
  maxTokens: number;
}

export interface MemoryConfig {
  dir: string;
}

export interface EphileoConfig {
  provider: string;
  providers: Record<string, ProviderConfig>;
  agent: AgentConfig;
  memory: MemoryConfig;
}

// --- Defaults (agent + memory only, provider must come from config.yaml) ---

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MEMORY_DIR = "./memory";

const CONFIG_HINT =
  "See config/config.example.yaml for a complete template.\n" +
  "Quick start: cp config/config.example.yaml config/config.yaml";

// --- Loader ---

let _cached: EphileoConfig | null = null;

/** Reset the config cache. Only for testing. */
export function _resetConfigCacheForTesting(): void {
  _cached = null;
}

/**
 * Find the project root (ephileo/) by walking up from this file.
 * This file lives at core/src/config/loader.ts, so project root is 3 levels up.
 */
function getProjectRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "..", "..", "..");
}

/**
 * Load and return the config. Cached after first call.
 */
export function loadConfig(): EphileoConfig {
  if (_cached) return _cached;

  const projectRoot = getProjectRoot();
  const configPath = resolve(projectRoot, "config", "config.yaml");

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}.\n` +
        "Create config/config.yaml with your provider settings:\n\n" +
        CONFIG_HINT,
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  const fileConfig: Partial<EphileoConfig> = parseYaml(raw) || {};

  if (!fileConfig.provider) {
    throw new Error(
      "Missing 'provider' in config/config.yaml.\n" +
        "Add a provider field at the top of the file:\n\n" +
        CONFIG_HINT,
    );
  }

  if (!fileConfig.providers || Object.keys(fileConfig.providers).length === 0) {
    throw new Error(
      "No providers configured in config/config.yaml.\n" +
        "Add at least one provider with baseUrl and model:\n\n" +
        CONFIG_HINT,
    );
  }

  const config: EphileoConfig = {
    provider: fileConfig.provider,
    providers: fileConfig.providers as Record<string, ProviderConfig>,
    agent: {
      maxTurns: fileConfig.agent?.maxTurns ?? DEFAULT_MAX_TURNS,
      maxTokens: fileConfig.agent?.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
    memory: {
      dir: fileConfig.memory?.dir ?? DEFAULT_MEMORY_DIR,
    },
  };

  // Environment variable overrides (highest priority)
  if (process.env.EPHILEO_PROVIDER) {
    config.provider = process.env.EPHILEO_PROVIDER;
  }
  if (process.env.EPHILEO_BASE_URL || process.env.EPHILEO_MODEL || process.env.EPHILEO_API_KEY) {
    const active = config.providers[config.provider] ?? { baseUrl: "", model: "" };
    config.providers[config.provider] = {
      baseUrl: process.env.EPHILEO_BASE_URL ?? active.baseUrl,
      model: process.env.EPHILEO_MODEL ?? active.model,
      apiKey: process.env.EPHILEO_API_KEY ?? active.apiKey,
    };
  }

  // Resolve memory dir relative to project root
  if (!isAbsolute(config.memory.dir)) {
    config.memory.dir = resolve(projectRoot, config.memory.dir);
  }

  _cached = config;
  return config;
}

/**
 * Get the active provider config.
 */
export function getActiveProvider(config?: EphileoConfig): ProviderConfig {
  const c = config ?? loadConfig();
  const provider = c.providers[c.provider];
  if (!provider) {
    throw new Error(
      `Provider "${c.provider}" not found in config. Available: ${Object.keys(c.providers).join(", ")}`,
    );
  }
  return provider;
}
