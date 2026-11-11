# Repo scripts in TypeScript run by Node's type stripping, tested through injected runners

**Date**: 2026-11-11
**Type**: pattern
**Theme**: toolchain
**Summary**: scripts/**/*.ts run under plain node, typecheck in tsconfig.scripts.json, and keep entry files branchless for coverage.
**Context**: .minerva/work/2026-11-11-terraform-doppler-deploy (see git history if the worktree has been cleaned up)

## Context
The deploy and bootstrap logic was too large and too security-sensitive for untyped `.mjs` or shell, but had to run with no build step under plain `node` in CI.

## Finding
- **Node 24 type stripping** runs `node scripts/deploy.ts` directly. It does no module resolution, so relative imports end in `.ts` (`allowImportingTsExtensions`), and it rejects non-erasable syntax such as parameter properties and enums (`erasableSyntaxOnly`). Those two flags live in `tsconfig.scripts.json`, which also typechecks `tests/scripts/**`. `tsconfig.node.json` excludes `tests/scripts/**`, or importing a script there fails with TS5097.
- **Entry files hold no branch:** each is `await runCli(import.meta, main)`. An `if (import.meta.main)` in the entry measured 66.66% lines / 50% branches and failed the 80% per-file floor. Tests import each entry (inert under vitest) and spawn it under plain `node` with an explicit env.
- **Every side effect is injected** (a `CommandRunner` for terraform/wrangler/gh/doppler, `fetch`, output, prompt, random bytes), so failure paths are unit-tested and child envs are asserted to be exact allowlists.
- **istanbul counts `??` and `?.` as branches**, so an unreachable fallback shows up as a coverage gap; removing the dead branch beat testing it.
- **A non-Error rejection** for a `String(error)` path is produced with `AbortSignal.abort(reason).throwIfAborted()`, since `Promise.reject` of a non-Error and thenables are linted out.
- **Each claimed pin is shown to fail** against a deliberately broken implementation before it counts (a re-serializing secrets writer, a bucket check that always creates, a deleted `exit 0`).

## Implications
- A new script goes in `scripts/<area>/*.ts` with an entry in `scripts/*.ts` (knip's entry glob) and tests in `tests/scripts/`.
- The `.mjs` scripts' `no-console` / `disableTypeChecked` carve-outs deliberately do not cover `.ts`; scripts print through `scripts/lib/output.ts`.

## Related
- [[2026-11-10-pattern-gates-pin-themselves]] — the same fail-when-broken rule, applied to script tests
- [[2026-11-10-constraint-import-x-needs-typescript-resolver-and-parsers]] — the resolver project list had to gain tsconfig.scripts.json
