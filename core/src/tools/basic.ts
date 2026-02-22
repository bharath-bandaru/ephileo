/**
 * Basic built-in tools — file operations, shell, and memory.
 *
 * These run directly in the TS process (no external worker needed).
 * Add more tools by calling registry.register().
 */

import { readFile, writeFile, appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { ToolRegistry } from "./registry.js";

const MEMORY_DIR = resolve(homedir(), "Developer", "ephileo", "memory");

export function registerBasicTools(registry: ToolRegistry): void {
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
      return content.slice(0, 10_000); // cap output
    },
  });

  registry.register({
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
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
      for (const name of entries.slice(0, 100)) {
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
          timeout: 30_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output.slice(0, 5000) || "(no output)";
      } catch (err: any) {
        const stderr = err.stderr || err.message || String(err);
        return `Error: ${String(stderr).slice(0, 2000)}`;
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
      await mkdir(MEMORY_DIR, { recursive: true });
      const journal = resolve(MEMORY_DIR, "learnings.md");
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
}
