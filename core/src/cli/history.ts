/**
 * File-based command history for the Ephileo REPL.
 *
 * Stores entries one per line in a plain text file. Multi-line entries
 * use escaped newlines (`\\n` literal) so each history entry stays on
 * a single file line.
 */

import { appendFileSync, readFileSync } from "node:fs";

const MAX_HISTORY_ENTRIES = 500;

/** Encode a multi-line input into a single file line. */
function encodeLine(entry: string): string {
  return entry.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Decode a single file line back into the original input. */
function decodeLine(line: string): string {
  let result = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\" && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === "n") {
        result += "\n";
        i += 2;
        continue;
      }
      if (next === "\\") {
        result += "\\";
        i += 2;
        continue;
      }
    }
    result += line[i];
    i++;
  }
  return result;
}

/** Load history entries from a file. Returns empty array if file doesn't exist. */
function loadHistory(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(-MAX_HISTORY_ENTRIES)
      .map(decodeLine);
  } catch {
    return [];
  }
}

/** Append a single entry to the history file. */
function appendHistory(filePath: string, entry: string): void {
  try {
    appendFileSync(filePath, `${encodeLine(entry)}\n`, "utf-8");
  } catch {
    // Silently ignore write failures (read-only FS, permissions, etc.)
  }
}

export { appendHistory, decodeLine, encodeLine, loadHistory, MAX_HISTORY_ENTRIES };
