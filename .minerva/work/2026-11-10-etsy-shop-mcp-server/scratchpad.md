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
