# Etsy shop MCP server

A remote [MCP](https://modelcontextprotocol.io) server that lets one Etsy seller manage her shop by chatting in Claude, ChatGPT or another MCP client. It runs on Cloudflare Workers.

**Status:** Phase 1 of 3. The strict toolchain, the CI merge gate and a Worker skeleton (`GET /health`) are in place. OAuth, the Etsy client and the shop tools arrive in Phases 2 and 3. The design is in `.minerva/work/2026-11-10-etsy-shop-mcp-server/proposal.md`.

## Development

Requires Node 24 (`.nvmrc`).

```sh
npm ci
npm run dev          # local Worker via wrangler
npm test             # workerd + Node test projects, with coverage
```

Every PR must pass the `ci-pass` check (typecheck, lint, format, knip, tests with coverage, build, generated-types freshness, secret scan). See `AGENTS.md` for the rules.

## Branch protection

`.github/rulesets/main.json` is the `main` ruleset (PR required, `ci-pass` required, no force-push, no deletion, no bypass). Apply it with `scripts/apply-ruleset.sh`, which needs `gh` authenticated as a repo admin.

**Break-glass:** `scripts/apply-ruleset.sh --disable` turns enforcement off, and `--enable` restores it. Use it only for a broken CI provider, never to merge past a failing check.
