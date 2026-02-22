/**
 * edit_file tool — targeted string replacement in files.
 *
 * The core logic (applyEdit) is a pure function with no I/O,
 * making it fully unit-testable without filesystem mocks.
 *
 * Replacement uses literal string matching (split/join), NOT regex,
 * so special characters like $, ., *, (, ) etc. work as-is.
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ToolRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditParams {
  content: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export type EditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/**
 * Apply a targeted string replacement to the given content string.
 * Uses literal string matching — no regex escaping required.
 */
export function applyEdit(params: EditParams): EditResult {
  const { content, oldString, newString, replaceAll } = params;

  if (oldString === "") {
    return { ok: false, error: "old_string must not be empty" };
  }

  if (oldString === newString) {
    return { ok: false, error: "old_string and new_string are identical" };
  }

  // Count occurrences using split — avoids regex special-character issues.
  const parts = content.split(oldString);
  const occurrences = parts.length - 1;

  if (occurrences === 0) {
    return { ok: false, error: "old_string not found in file" };
  }

  if (occurrences > 1 && replaceAll !== true) {
    return {
      ok: false,
      error: `old_string matches ${occurrences} times. Use replace_all: true or provide more context to make it unique.`,
    };
  }

  const resultContent = parts.join(newString);
  return { ok: true, content: resultContent, replacements: occurrences };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/** Register the edit_file tool with the given registry. */
export function registerEditTool(registry: ToolRegistry): void {
  registry.register({
    name: "edit_file",
    description:
      "Perform a targeted string replacement in a file. " +
      "Fails if old_string is not found, or if it appears multiple times and replace_all is not set. " +
      "Use read_file first to confirm the exact text to replace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or home-relative (~) path to the file to edit.",
        },
        old_string: {
          type: "string",
          description:
            "The exact text to find and replace. Must appear exactly once unless replace_all is true.",
        },
        new_string: {
          type: "string",
          description: "The text to replace old_string with.",
        },
        replace_all: {
          type: "boolean",
          description: "If true, replace every occurrence of old_string. Defaults to false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    requiresConfirmation: true,
    async handler(args) {
      const p = resolve(String(args.path).replace(/^~/, homedir()));
      const oldString = String(args.old_string);
      const newString = String(args.new_string);
      const replaceAll = args.replace_all === true;

      let existing: string;
      try {
        existing = await readFile(p, "utf-8");
      } catch (err: unknown) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }

      const result = applyEdit({ content: existing, oldString, newString, replaceAll });

      if (!result.ok) {
        return `Error: ${result.error}`;
      }

      try {
        await writeFile(p, result.content, "utf-8");
      } catch (err: unknown) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }

      return `Replaced ${result.replacements} occurrence${result.replacements === 1 ? "" : "s"} in ${p}`;
    },
  });
}
