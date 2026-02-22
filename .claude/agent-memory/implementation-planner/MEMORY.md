# Ephileo Project Memory

## Architecture
- CLI (`core/src/cli/index.ts`, 333 lines) -> Agent Loop (`core/src/agent/loop.ts`, 89 lines) -> LLM Client (`core/src/llm/client.ts`, 332 lines)
- Tool Registry (`core/src/tools/registry.ts`, 57 lines) + Basic Tools (`core/src/tools/basic.ts`, 138 lines)
- Config Loader (`core/src/config/loader.ts`, 149 lines)
- CLI Input (`core/src/cli/input.ts`, 237 lines)
- No config barrel export exists; config is imported directly from `loader.ts`

## Key Patterns
- **Error handling**: Tools return error strings (never throw). LLM client throws (caller handles).
- **Pure library code**: `agent/loop.ts` and `llm/client.ts` must NOT import CLI or I/O code.
- **Barrel exports**: `agent/index.ts`, `tools/index.ts`, `llm/index.ts` re-export public API. No config barrel.
- **Testing**: Vitest, files named `*.test.ts` next to source. Use `vi.mock` for mocks.
- **Module globals**: Only `showThinking` (CLI) and `_cached` (config) are allowed mutable module-level state.
- **Parameters over globals**: Config/state passed as function args.
- **Agent loop signature**: `runAgentLoop(messages, llm, tools, log?, onToken?, maxTurns?)` returns `AgentResult`.
- `ToolRegistry.execute(name, args)` returns `Promise<string>` - called inside the agent loop's tool execution for-loop.

## File Size Tracking
- `cli/index.ts`: 333 lines (OVER 300 soft limit, approaching concern zone)
- `llm/client.ts`: 332 lines (OVER 300 soft limit)
- `cli/input.ts`: 237 lines (OK)
- `config/loader.ts`: 149 lines (OK)
- `tools/basic.ts`: 138 lines (OK)
- `agent/loop.ts`: 89 lines (OK)
- `tools/registry.ts`: 57 lines (OK)

## Important Interfaces (see details -> [interfaces.md](interfaces.md))
- `ToolHandler = (args: Record<string, unknown>) => Promise<string>`
- `ToolRegistration { name, description, parameters, handler, requiresConfirmation? }` (confirmation field planned)
- `ToolRegistry` class with `register`, `getSchemas`, `execute`, `listNames`
- `AgentResult { response, turns, toolsUsed }`
- `LogFn = (message: string) => void`
- `ChatMessage`, `ToolCall`, `LLMResponse` in `llm/client.ts`
- `ToolDefinition` in `llm/client.ts` (OpenAI function-calling format)

## Tool Organization Pattern
- Simple tools stay in `basic.ts`, complex tools get own file (e.g., `edit.ts`)
- `registerBasicTools` in `basic.ts` calls sub-registrations (e.g., `registerEditTool`)
- No `basic.test.ts` exists yet -- only `registry.test.ts`
- No `requiresConfirmation` infrastructure exists yet in registry or agent loop
- `shell` tool does NOT have confirmation -- flagged for future discussion
