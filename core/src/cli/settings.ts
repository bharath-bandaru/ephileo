/**
 * Persistent CLI settings — stored as JSON in `.ephileo_settings` at project root.
 *
 * Designed to hold any future `/` command settings alongside permissions.
 * Reads/writes are synchronous to keep startup simple.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PermissionLevel } from "../tools/index.js";

const SETTINGS_FILENAME = ".ephileo_settings";

/** Shape of the persisted settings file. Extend this as new settings are added. */
export interface EphileoSettings {
  permissionLevel?: PermissionLevel;
}

const VALID_PERMISSION_LEVELS: readonly string[] = ["write-only", "read-and-write", "auto-accept"];

function settingsPath(): string {
  return resolve(process.cwd(), SETTINGS_FILENAME);
}

/** Load settings from disk. Returns empty object if file is missing or invalid. */
export function loadSettings(filePath?: string): EphileoSettings {
  try {
    const raw = readFileSync(filePath ?? settingsPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const obj = parsed as Record<string, unknown>;
    const settings: EphileoSettings = {};
    if (
      typeof obj.permissionLevel === "string" &&
      VALID_PERMISSION_LEVELS.includes(obj.permissionLevel)
    ) {
      settings.permissionLevel = obj.permissionLevel as PermissionLevel;
    }
    return settings;
  } catch {
    return {};
  }
}

/** Save settings to disk. Merges with any existing settings. */
export function saveSettings(updates: EphileoSettings, filePath?: string): void {
  const path = filePath ?? settingsPath();
  const existing = loadSettings(path);
  const merged = { ...existing, ...updates };
  try {
    writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  } catch {
    // Silently ignore write failures (read-only FS, permissions, etc.)
  }
}
