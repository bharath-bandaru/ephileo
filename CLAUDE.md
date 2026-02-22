# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
**This file is the highest-priority reference. Follow these rules strictly.**

## Project

Ephileo is a local-first AI agent — TypeScript orchestrator ("Brain") with Python workers ("Hands", coming later). All AI inference runs locally via exo/ollama or cloud APIs through an OpenAI-compatible interface.

## Architecture

```
CLI (cli/) → Agent Loop (agent/) → LLM Client (llm/)
                ↓
          Tool Registry (tools/)
                ↓
     Config Loader (config/)
```

- **cli/index.ts** — REPL + one-shot CLI, streaming display, hotkey listener
- **agent/loop.ts** — Core loop: LLM → tool call → execute → feed back → repeat
- **llm/client.ts** — Streaming SSE client for OpenAI-compatible APIs, think-block detection
- **tools/registry.ts** — Tool registration, schema generation, execution
- **tools/basic.ts** — Built-in tools (read_file, write_file, list_directory, shell, save_learning)
- **config/loader.ts** — YAML config with env var overrides, cached singleton

## Commands

```bash
cd core
npm run dev          # Start interactive REPL (tsx)
npm run check        # Biome lint + tsc --noEmit (run before every commit)
npm test             # Vitest unit tests
npm run lint:fix     # Auto-fix lint + format
npm run build        # Compile to dist/
```

## Strict Coding Standards

### Zero tolerance

- **No `any`** — Biome enforces `noExplicitAny: error`. Use `unknown` + type narrowing or structural assertions.
- **No `@ts-ignore` / `@ts-nocheck`** — Fix the type error properly.
- **No non-null assertions (`!`)** — Use proper null checks, `??`, or early returns. Biome warns on these.
- **No magic numbers** — Extract into named `const` at module top. Every number that isn't 0, 1, or -1 needs a name.
- **No hardcoded paths** — Use config values or parameters. Never embed absolute paths in source.
- **No `console.log` in library code** — CLI layer uses `process.stderr.write` for display. Library code returns values.

### TypeScript

- `strict: true` is enabled. Do not weaken it.
- Use `import type` for type-only imports (Biome enforces `useImportType`).
- Use `const` by default (Biome enforces `useConst: error`).
- Prefer `unknown` over `any` in catch blocks: `catch (err: unknown)`.
- Interface for data shapes, `type` for function signatures and unions.
- All new interfaces for external data (API responses, SSE chunks) must be explicitly typed — no casting `JSON.parse` to `any`.

### Code style (Biome enforced)

- 2-space indentation, double quotes, always semicolons, 100-char line width.
- Imports sorted alphabetically by Biome's `organizeImports`.
- `node:` prefix required for Node.js built-in imports.
- Dot notation over bracket notation for known properties.

### Architecture rules

- **Keep files under 300 lines.** Split if approaching this.
- **Parameters over globals.** Pass config/state as function arguments, not module-level variables. The only acceptable module-level mutable state is `showThinking` (CLI-only) and `_cached` (config memo).
- **Pure functions in library code.** `agent/loop.ts` and `llm/client.ts` must not import CLI or I/O code.
- **Barrel exports.** Each directory has an `index.ts` that re-exports the public API. Import from the barrel, not from internal files.
- **Error handling.** Return error strings from tools (don't throw). Throw from LLM client (caller handles). Use `err instanceof Error ? err.message : String(err)` pattern.

### Testing

- **Vitest** for all tests. Files named `*.test.ts` next to source.
- Tests excluded from `tsc` build via `tsconfig.json`.
- Test every new utility function and every new tool.
- Use `vi.mock` for filesystem/network mocks. Use `_resetConfigCacheForTesting()` between config tests.

### Before submitting any change

1. `npm run check` — zero lint errors, zero type errors
2. `npm test` — all tests pass
3. No new `any`, no new `!`, no new magic numbers
