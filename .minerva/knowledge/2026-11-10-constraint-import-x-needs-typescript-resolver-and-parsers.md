# import-x rules are silently inert on TypeScript without a resolver and parsers

**Date**: 2026-11-10
**Type**: constraint
**Theme**: toolchain
**Summary**: import-x no-cycle reports nothing on TS files unless resolver, parsers and extensions are configured.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
Phase 1 enabled `import-x/no-cycle` and `import-x/no-extraneous-dependencies` and lint passed. An independent review then showed that two `src/` files importing each other linted clean. The installed `eslint-import-resolver-typescript` was never referenced.

## Finding
`eslint-plugin-import-x` needs all three of the following, or extensionless TS imports (`./b`) never resolve and dependencies are never parsed:
- `settings["import-x/resolver-next"]` = `[createTypeScriptImportResolver({ project: [...] })]`;
- `settings["import-x/parsers"]` = `{ "@typescript-eslint/parser": [".ts", ".mts", ".cts"] }`;
- `settings["import-x/extensions"]`.

Without them, `no-cycle` sees no edges and reports nothing, which looks like coverage. `import-x/no-unresolved` is the canary: it errors when resolution is broken.

## Implications
- Keep `import-x/no-unresolved` on. If it is ever turned off, resolution can break silently again.
- `tests/lint-gate.test.ts` lints `tests/lint-fixtures/cycle-a.ts` and asserts `import-x/no-cycle` fires. Keep that fixture; it is the only proof the rule works.
- The general lesson: a lint rule passing on clean code says nothing. Every guard rule needs a fixture that it must flag.

## Related
- [[2026-11-10-pattern-gates-pin-themselves]] — the lint-gate fixtures are part of that self-pinning
