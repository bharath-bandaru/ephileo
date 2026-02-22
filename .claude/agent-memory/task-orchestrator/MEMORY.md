# Task Orchestrator Memory

See topic files linked below for details.

## Key References
- Architecture patterns: `patterns.md`
- Common Biome failures: `biome-failures.md`

## Quick Facts
- Working directory for npm commands: `core/`
- Quality gates: `npm run check` (Biome + tsc) then `npm test` (Vitest)
- Barrel: `core/src/tools/index.ts` — always update when adding new exports
- File limits: soft 300 lines, hard 500 lines
