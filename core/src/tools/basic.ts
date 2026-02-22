/**
 * Basic built-in tools — file operations, shell, and memory.
 *
 * These run directly in the TS process (no external worker needed).
 * Add more tools by calling registry.register().
 */

import { execSync } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { registerEditTool } from "./edit.js";
import type { ToolRegistry } from "./registry.js";

const MAX_FILE_READ_CHARS = 10_000;
const MAX_SHELL_OUTPUT_CHARS = 5_000;
const MAX_SHELL_ERROR_CHARS = 2_000;
const SHELL_TIMEOUT_MS = 30_000;
const MAX_DIR_ENTRIES = 100;

export function registerBasicTools(registry: ToolRegistry, memoryDir: string): void {
  registry.register({
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
    async handler(args) {
      const p = resolve(String(args.path).replace(/^~/, homedir()));
      const content = await readFile(p, "utf-8");
      return content.slice(0, MAX_FILE_READ_CHARS); // cap output
    },
  });

  registry.register({
    name: "write_file",
    description:
      "Create a NEW file with the given content. OVERWRITES the entire file if it exists. " +
      "For editing existing files, use edit_file instead. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    requiresConfirmation: true,
    async handler(args) {
      const p = resolve(String(args.path).replace(/^~/, homedir()));
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, String(args.content), "utf-8");
      return `Written ${String(args.content).length} chars to ${p}`;
    },
  });

  registry.register({
    name: "list_directory",
    description: "List files and directories at a given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path. Defaults to current directory." },
      },
      required: [],
    },
    async handler(args) {
      const p = resolve(String(args.path || ".").replace(/^~/, homedir()));
      const entries = await readdir(p);
      const lines: string[] = [];
      for (const name of entries.slice(0, MAX_DIR_ENTRIES)) {
        const s = await stat(resolve(p, name));
        lines.push(`  [${s.isDirectory() ? "dir" : "file"}] ${name}`);
      }
      return `${p}/\n${lines.join("\n")}`;
    },
  });

  registry.register({
    name: "shell",
    description: "Run a shell command and return its output. Use for system info, searching, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
    async handler(args) {
      try {
        const output = execSync(String(args.command), {
          timeout: SHELL_TIMEOUT_MS,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output.slice(0, MAX_SHELL_OUTPUT_CHARS) || "(no output)";
      } catch (err: unknown) {
        const error = err as { stderr?: string; message?: string };
        const stderr = error.stderr ?? error.message ?? String(err);
        return `Error: ${String(stderr).slice(0, MAX_SHELL_ERROR_CHARS)}`;
      }
    },
  });

  registry.register({
    name: "save_learning",
    description:
      "Save something Ephileo learned to the memory journal. Use this to record discoveries, summaries, and insights from tasks.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Short topic title" },
        content: { type: "string", description: "What was learned — markdown formatted" },
      },
      required: ["topic", "content"],
    },
    async handler(args) {
      await mkdir(memoryDir, { recursive: true });
      const journal = resolve(memoryDir, "learnings.md");
      const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const entry = `\n## ${args.topic}\n_Learned: ${timestamp}_\n\n${args.content}\n\n---\n`;

      try {
        await readFile(journal, "utf-8");
      } catch {
        // File doesn't exist, create with header
        await writeFile(
          journal,
          "# Ephileo Learning Journal\n\nThings I've learned and discovered.\n\n---\n",
          "utf-8",
        );
      }

      await appendFile(journal, entry, "utf-8");
      return `Saved learning about '${args.topic}' to ${journal}`;
    },
  });

  registerEditTool(registry);
}
