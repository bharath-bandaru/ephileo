# Architecture Patterns

## Tool implementation pattern
1. Put pure logic in an exported function (no I/O) — makes it unit-testable without mocks
2. Put I/O (readFile, writeFile) in the handler only
3. Return error strings from tools (don't throw) — catch errors and return them
4. Use discriminated union for results: `{ ok: true; ... } | { ok: false; error: string }`
5. Set `requiresConfirmation: true` on tools that write/modify files

## Adding a new tool checklist
- [ ] Create `tools/<name>.ts` with pure logic + `register<Name>Tool(registry)` function
- [ ] Create `tools/<name>.test.ts` testing the pure logic (no mocks needed)
- [ ] Import and call `register<Name>Tool(registry)` at the end of `registerBasicTools` in `basic.ts`
- [ ] Export types and functions from `tools/index.ts` barrel (type exports before value exports)
- [ ] Run `npm run check && npm test`

## Literal string matching (not regex)
- Use `content.split(oldString)` to count/replace — works for all special characters
- Never use `new RegExp(oldString)` on user-provided strings without escaping

## ToolRegistration interface (registry.ts)
- Fields: `name`, `description`, `parameters`, `handler`, `requiresConfirmation?`
- `requiresConfirmation` is optional boolean — no confirmation mechanism yet, future feature

## Test patterns (Vitest)
- Test files: `*.test.ts` next to source
- Pure functions: test directly, no mocks needed
- File I/O tools: mock with `vi.mock("node:fs/promises", ...)`
- Config tests: call `_resetConfigCacheForTesting()` between tests
