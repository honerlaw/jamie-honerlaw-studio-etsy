# The Workers test pool has quirks that shape how this repo's tests are written

**Date**: 2026-11-11
**Type**: constraint
**Theme**: workers-platform
**Summary**: vitest-plugin lacks fetchMock and storage isolation; ScheduledController can't cross exports.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
Worker tests run in workerd through `@cloudflare/vitest-plugin` 1.7, which replaces the deprecated `@cloudflare/vitest-pool-workers`.

## Finding
- The plugin exports no `fetchMock` and doesn't isolate storage per test. Tests spy on `globalThis.fetch`, which the Worker and its Durable Objects share in the test isolate, and `test/support/setup.ts` resets storage after each test.
- A Durable Object's request body can't be read from the test's context, so the Etsy mock records request bodies eagerly.
- A `ScheduledController` can't be serialized through `exports` (DataCloneError). The cron test imports the worker's default export and calls `scheduled` directly.
- The MCP transport is the SDK's stateless `WebStandardStreamableHTTPServerTransport` with a fresh `McpServer` per request, not `agents`' `McpAgent`. That drops a Durable Object class and a heavy dependency, and lets protocol tests call `/mcp` like any route.

## Implications
- New tests that need Etsy use `mockEtsy()` routes keyed by `"METHOD path"`, which can be async. They read `writes()` and `reads()` for call counts.
- Hard-to-reach branches (crypto, storage, time) are tested through injected interfaces, never excluded from coverage.

## Related
- [[2026-11-10-constraint-toolchain-version-pins]] — the toolchain versions these quirks belong to
