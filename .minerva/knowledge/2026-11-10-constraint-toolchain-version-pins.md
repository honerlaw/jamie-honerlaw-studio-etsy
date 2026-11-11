# Toolchain version pins forced by peer ranges (TS 5.9, vitest-plugin, wrangler types)

**Date**: 2026-11-10
**Type**: constraint
**Theme**: toolchain
**Summary**: TypeScript stays on 5.9 and Workers tests use @cloudflare/vitest-plugin with wrangler-generated types.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
In November 2026 the newest releases didn't fit together: TypeScript 7.0, ESLint 10, vitest 5. The Cloudflare test package had also been renamed.

## Finding
- **TypeScript is pinned to 5.9.x.** `typescript-eslint` 8.72 peers `typescript <6.1`, and `openapi-typescript` 7.13 peers `^5`.
- **`@cloudflare/vitest-pool-workers` is deprecated.** Use `@cloudflare/vitest-plugin`, a Vite plugin `cloudflareTest({ wrangler: { configPath } })` placed in a vitest project. It supports vitest 4 and 5.
- **`wrangler types` supersedes `@cloudflare/workers-types`.** It generates `worker-configuration.d.ts` (runtime types plus `Env`, plus `Cloudflare.GlobalProps.mainModule`, which types `exports.default` from `cloudflare:workers` in tests). It must be regenerated after any `wrangler.jsonc` change, and CI runs `wrangler types --check`.
- `eslint-plugin-unicorn` 79 renamed `no-array-for-each` to `no-for-each`.

## Implications
- Raise TypeScript only when both typescript-eslint and openapi-typescript accept the new major.
- Dependabot groups `wrangler`, `@cloudflare/vitest-plugin`, `vitest` and `@vitest/coverage-istanbul` so they move together.
- npm 11 `allowScripts` pins exact esbuild and workerd versions. A wrangler bump that pulls a new workerd needs its postinstall approved (`npm install-scripts approve workerd`).

## Related
- [[2026-11-10-pattern-gates-pin-themselves]] — the version set is validated by the same gates
