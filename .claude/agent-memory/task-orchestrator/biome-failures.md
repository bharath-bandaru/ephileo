# Common Biome Failures

## Import/export ordering in barrel files (index.ts)
- `type` exports must come BEFORE value exports from the same module
- Biome's `organizeImports` enforces: `export type { ... }` before `export { ... }` when from same path
- Example correct order:
  ```ts
  export type { EditParams, EditResult } from "./edit.js";
  export { applyEdit, registerEditTool } from "./edit.js";
  ```

## Line length (100-char limit)
- String literals inside object properties that exceed 100 chars must be broken after the key:
  ```ts
  // Wrong (single line > 100 chars):
  description: "Long string that exceeds the limit...",
  // Correct (Biome's preferred format):
  description:
    "Long string that exceeds the limit...",
  ```
- This applies inside schema `parameters` objects in tool registrations.

## Auto-fix available
- Run `npm run lint:fix` to auto-apply safe Biome fixes before checking.
