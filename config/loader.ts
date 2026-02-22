/**
 * Config loader — reads config.yaml, validates, and exports a typed object.
 *
 * Resolution order (highest priority wins):
 *   1. Environment variables (EPHILEO_PROVIDER, EPHILEO_BASE_URL, etc.)
 *   2. config.yaml
 *   3. Built-in defaults
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

// --- Defaults ---

const DEFAULTS: EphileoConfig = {
  provider: "exo",
  providers: {
    exo: {
      baseUrl: "http://localhost:52415/v1",
      model: "mlx-community/Qwen3-30B-A3B-4bit",
    },
  },
  agent: {
    maxTurns: 20,
    maxTokens: 4096,
  },
  memory: {
    dir: "./memory",
  },
};

// --- Loader ---

let _cached: EphileoConfig | null = null;

/**
 * Load and return the config. Cached after first call.
 */
export function loadConfig(): EphileoConfig {
  if (_cached) return _cached;

  // Find config.yaml relative to the project root (ephileo/)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(thisDir, "config.yaml");

  let fileConfig: Partial<EphileoConfig> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    fileConfig = parseYaml(raw) || {};
  }

  // Merge: defaults <- file config
  const config: EphileoConfig = {
    provider: fileConfig.provider ?? DEFAULTS.provider,
    providers: { ...DEFAULTS.providers, ...fileConfig.providers },
    agent: { ...DEFAULTS.agent, ...fileConfig.agent },
    memory: { ...DEFAULTS.memory, ...fileConfig.memory },
  };

  // Environment variable overrides (highest priority)
  if (process.env.EPHILEO_PROVIDER) {
    config.provider = process.env.EPHILEO_PROVIDER;
  }
  if (process.env.EPHILEO_BASE_URL || process.env.EPHILEO_MODEL || process.env.EPHILEO_API_KEY) {
    // Env vars override the active provider's settings
    const active = config.providers[config.provider] ?? { baseUrl: "", model: "" };
    config.providers[config.provider] = {
      baseUrl: process.env.EPHILEO_BASE_URL ?? active.baseUrl,
      model: process.env.EPHILEO_MODEL ?? active.model,
      apiKey: process.env.EPHILEO_API_KEY ?? active.apiKey,
    };
  }

  // Resolve memory dir relative to project root
  if (!config.memory.dir.startsWith("/")) {
    const projectRoot = resolve(thisDir, "..");
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
