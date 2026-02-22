# Code Writer Agent Memory

## Project Structure
- **Root**: `/Users/bharathbandaru/Developer/ephileo`
- **Core package**: `core/` (run `npm` commands from here)
- **Source**: `core/src/` with subdirs: `cli/`, `agent/`, `llm/`, `tools/`, `config/`
- **No barrel export for cli/** -- `cli/index.ts` is the entry point, not a barrel. Other dirs have `index.ts` barrels.

## File Line Counts (last checked)
- `cli/index.ts`: ~312 lines (near 300-line soft limit)
- `cli/input.ts`: ~238 lines (comfortable)
- `cli/input.test.ts`: ~355 lines (test files OK to be longer)

## Key Patterns
- Biome formatter preferences: single-line destructuring when it fits in 100 chars, single-line type unions when short
- Use `import type` for type-only imports (Biome enforced)
- Tests use `PassThrough` from `node:stream` for mock streams
- CLI uses `process.stderr.write` for output, not `console.log` in library code
- `node:` prefix required for all Node.js built-in imports

## Testing Patterns
- Vitest with `vi.mock` and `vi.fn()`
- Test files: `*.test.ts` next to source
- Mock TTY streams: extend `PassThrough` with `isTTY: true` and `setRawMode: vi.fn()`
- Tests excluded from tsc build via `tsconfig.json` exclude

## Biome Gotchas
- Formatter enforces single-line when content fits in 100 chars (destructuring, type unions)
- `noUnusedImports` catches unused `type` imports too
- Run `npm run lint:fix` to auto-fix formatting issues
