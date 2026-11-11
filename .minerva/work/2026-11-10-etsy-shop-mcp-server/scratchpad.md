# Scratchpad: etsy-shop-mcp-server

> **Ephemeral working memory.** Most of what lands here is noise — small
> decisions that don't matter, dead ends, momentary confusion. At feature
> completion, run `minerva:promote`: significant items get promoted to
> `.minerva/knowledge/`, `proposal.md` gets updated to match reality, and
> the raw scratchpad is archived.

## Decisions 2026-11-10
- [user-directed] scope check: one unit, 3 phased PRs (toolchain+CI+skeleton / OAuth+vault+client / tools) — user picked "3 phased PRs" when asked; v1 scope (listings, orders, inventory, insights) and costly/destructive-only confirms also user answers
- [panel — 3/3 accept, 3 with fixes] approach: option B — Workers + workers-oauth-provider, Etsy tokens in an EtsyTokenVault DO; rejected A (tokens in grant props via tokenExchangeCallback: refresh coupled to MCP client refresh, rotation race, no background refresh) and C (Node + hand-rolled AS + Postgres) (tier: panel — blast-radius doubt: auth design guards buyer PII and her shop; parallel wave)
    - fix (all): PII policy; bootstrap mode off by default, fail closed, no grant/vault write; state + PKCE verifier binding with replay rejection; invalid_grant → clear vault, revoke grants, reconnect error; encryption scheme (kid prefix, IV, AAD=shop id, rotation, loss = reconnect); single atomic put; why-A-not-B note; upload limits/CSP; rename types job + zod-parse critical responses; lint carve-outs; Dependabot/cost; runbook
- [reviewed — clean→stale] whole-proposal (first wave): Skeptic returned revise (DO-serialization claim wrong, generated-file ignores, istanbul coverage, lint-fixture wording, ruleset checkability, missing renew tool, deploy path) — discarded as stale at the restart check (tier: reviewer; parallel wave)
- [reviewed — folded] whole-proposal (restart): restart because the approach fold added Phase 2 success criteria; restarted Skeptic flagged KV non-atomic single-use (OAuth state, upload nonce), open-DCR phishing, honor-system confirm, Free-plan subrequest limit, vitest project split, ci-pass completeness, ruleset bootstrap — all folded (redirect-URI-restricted DCR, OneTimeStore DO, preview-bound confirmation token, paginated cron, two vitest projects, ci-structure test, pre-merge ruleset + break-glass) (tier: reviewer — new interfaces, no panel clause; Skeptic: panel not warranted)
- [rechecked — escalated] whole-proposal: fold-audit found 6 items partially closed and new concern #5 (attach consumed the nonce before streaming, so a mid-attach Etsy failure lost the session with no retry), which the author judged load-bearing → panel; residuals folded first (lease-based attach, DO count, deps named, JCS args hash, preview ≤2 reads)
- [panel — 3/3 accept, 3 with fixes] whole-proposal: approved (tier: panel — fold-audit escalation)
    - fix (arbiter/skeptic): tests/gate-integrity.test.ts pins tsconfig flags, --max-warnings 0, coverage (global 90 + per-file 80), ci-pass needs, ruleset deletion/non_fast_forward/empty bypass_actors, named rules at error
    - fix: minimal wrangler.jsonc in Phase 1, extended later
    - fix: wrapper fallback for /register redirect check + audience re-check; client-metadata-URL note
    - fix: get_shop_overview reports `cron: not yet run`; scope-derivation test from spec security annotations
    - fix: Phase 3 live smoke checklist (non-gating); Phase 3 may ship as stacked sub-PRs; CPU-time assumption + Paid fallback
    - fix: @modelcontextprotocol/sdk + zod named in Phase 2; research secret/PII scan before commit; Dependabot group for the Cloudflare/vitest set; re-export fixture; per-phase criteria pointer; Connecting outcome recorded as Phase 3's first commit; Etsy QPS listed as known gap
- [reviewed — clean] completion verification (phase 1): Verifier reproduced the full gate chain (all exit 0, 15 tests, 100% coverage) and accepted criteria 1–3 and 6. Criteria 4 (ci-pass green on PR) and 5 (ruleset applied) were judged legitimately deferred to ship. Ship to-dos: enable allow_auto_merge + delete_branch_on_merge, apply and verify the ruleset, confirm ci-pass green (tier: reviewer floor — no interface beyond what the proposal approved)
- [solo] review triage (phase 1): 13 FIX / 1 SUGGEST / 0 IGNORE (tier: default-solo row — every finding had a writable failure scenario and an absorbable fix; none had two defensible dispositions)

## Work notes — Phase 1 (2026-11-10)
- `@cloudflare/vitest-pool-workers` is deprecated, renamed to `@cloudflare/vitest-plugin` (1.7.0). It is a Vite plugin `cloudflareTest({ wrangler: { configPath } })` used inside a vitest project, and it supports vitest 5. Switched; the proposal's name is stale.
- `wrangler types` now generates runtime types (`worker-configuration.d.ts`, ~16k lines, committed) and supersedes `@cloudflare/workers-types`, which is removed. `exports.default.fetch()` from `cloudflare:workers` is only typed with it (`Cloudflare.GlobalProps.mainModule`). CI checks freshness with `wrangler types --check`, folded into the `generated-types-match` job alongside the Etsy types check. The proposal named that job `etsy-types-match-snapshot`.
- TypeScript is pinned to **5.9.3**, not 6/7: typescript-eslint 8.72 peers `typescript <6.1`, and openapi-typescript 7.13 peers `^5`. Revisit when both widen.
- eslint-plugin-unicorn 79 has no `no-array-for-each`; the rule is `unicorn/no-for-each`.
- Type-aware lint uses explicit `project: [tsconfig.json, tsconfig.node.json]`, not the project service. Worker code and Node-side code need different `types`, and the project service can't map tests/ to the second config.
- `agentic/one-export-per-file` does **not** count re-exports (`export { x } from`), as pinned by the lint-gate re-export fixture. `src/index.ts` needs no carve-out for it when it re-exports DO classes.
- The per-file 80% coverage floor is enforced by `scripts/check-coverage-floor.mjs` over istanbul's `json-summary`, because vitest's `perFile` applies one number to every file and can't also hold a 90% global.
- Research: Etsy's doc HTML is copyrighted, so it is NOT committed to this public repo. Local copies live in gitignored `docs/research/etsy/raw/`. Committed: the OpenAPI spec (`etsy/openapi.json`), `docs/research/etsy/README.md` (source URLs) and `.minerva/reference/etsy-api.md` (our own summary). `headers.txt` was dropped (it held an Etsy anonymous `set-cookie`). Gitleaks: no leaks; the `x-api-key`/`Bearer` strings in the docs are Etsy's placeholder examples.
- npm 11 `allowScripts`: esbuild and workerd postinstalls approved, fsevents denied (macOS-only optional dependency).
- `npm audit`: 0 production vulnerabilities. The dev-only advisories (minimatch, undici, zod via wrangler/miniflare, sharp) are transitive through the Cloudflare toolchain.

## Review triage 2026-11-10 (phase 1)
Independent diff review, 14 findings:
1. FIX (high): import-x/no-cycle was inert because no TS resolver or parsers were configured. Wired `eslint-import-resolver-typescript` via `import-x/resolver-next` plus `import-x/parsers` and `import-x/extensions`, added `import-x/no-unresolved`, and the lint-gate cycle fixture now proves it fires.
2. FIX: the spec-drift issue body rendered escaped backticks. It is now built with echo into a `--body-file`.
3. FIX: core rules and js recommended covered only `.ts`, so `scripts/*.mjs` was nearly unlinted. They now apply to `**/*.{ts,mjs}` with Node globals for scripts, and the lint-gate `loose-script.mjs` fixture proves it.
4. FIX: the required `ci-pass` check is pinned to `integration_id` 15368 (GitHub Actions), so a forged commit status can't satisfy it.
5. FIX: the drift workflow fails on a non-JSON response instead of filing a bogus issue.
6. FIX: ci-structure now rejects `continue-on-error` and `|| true`-style swallowing, and asserts each gate job runs its command.
7. FIX: `cancel-in-progress` applies only to PRs, never to runs on main.
8. FIX: apply-ruleset.sh refuses when two rulesets share the name.
9. FIX: `health.ts` was renamed to `handle-health.ts` (the filename matches the export).
10. FIX: covered by #1; the resolver dependency is now used.
11. FIX: gate-integrity also pins tsconfig.node.json (lib/types only), the METRICS list, the unicorn/no-unnecessary-condition/only-throw-error/no-unresolved rules, and rule severities for tests/ and scripts/.
12. FIX: `tests/check-scripts.test.ts` proves both check scripts can fail. The coverage floor now fails closed on non-numeric pct and on an empty summary.
13. SUGGEST: `allowScripts` pins exact esbuild/workerd versions, so a Dependabot wrangler bump may pull a new workerd whose postinstall isn't approved. Check it on the first Dependabot PR.
14. FIX (preemptive): gitleaks-action replaced by the pinned, checksum-verified gitleaks CLI (v8.30.1), which needs no extra token scopes.

## Mode B promotions (phase 1)
- import-x resolver/parsers constraint → promoted to .minerva/knowledge/2026-11-10-constraint-import-x-needs-typescript-resolver-and-parsers.md
- self-pinning gates pattern → promoted to .minerva/knowledge/2026-11-10-pattern-gates-pin-themselves.md
- toolchain version pins (TS 5.9, vitest-plugin, wrangler types, unicorn rename, allowScripts) → promoted to .minerva/knowledge/2026-11-10-constraint-toolchain-version-pins.md
