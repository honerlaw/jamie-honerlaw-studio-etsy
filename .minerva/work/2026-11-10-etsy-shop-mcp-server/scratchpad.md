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
- [solo] MCP transport (phase 2): use the MCP SDK's stateless `WebStandardStreamableHTTPServerTransport` instead of `agents`' `McpAgent` (tier: solo — internal component swap behind the same `/mcp` Streamable HTTP contract; reversible; no success criterion depends on it; the `agents` 0.33 docs themselves steer new stateless servers away from McpAgent; drops a heavy dependency and a Durable Object class)
- [reviewed — revise, no unmet criterion] completion verification (phase 2): Verifier reproduced all gates (142 tests) and judged criteria 1–11 honestly met; its `revise` named one gap outside the checklist: the README's first deploy would fail because `secrets.required` makes wrangler refuse a new Worker without secrets → fixed as a review FIX (first deploy now uses `--secrets-file .dev.vars` in bootstrap mode), not a replan, since no success criterion is unmet (tier: reviewer floor — no interface beyond what the proposal approved: the MCP transport swap keeps the `/mcp` contract, and the scope set follows the approved derivation rule)
- [user-directed] review finding #1 (phishing via shared Claude/ChatGPT callbacks: anyone can register a client with those redirect URIs and phish a grant): Skeptic showed a passphrase or rate limit doesn't stop it; escalated as replan-vs-FIX; user: "we should have a [list] of some sort that we control who can login entirely" → replan (escalation 1)
- [user-directed] review finding #5 (unauthenticated DCR can exhaust the Free-plan KV write quota): user: "this is not a public app that other people can consume... there doesn't need to be signup / consent" → folded into the same replan
- [user-directed] new-plan acceptance (replan 2026-11-10): closed `MCP_CLIENTS` list of confidential clients, no DCR, no consent page; the user's answer is applied as the panel's accept (round-table escalation rule)
- [solo] client provisioning: write a minimal base record only when `lookupClient` is null, then set name/redirects/secret through the library's public `updateClient` (it hashes the secret), re-synced only when an entry's fingerprint changes (tier: solo — internal to the approved replan; test/clients.test.ts runs the full flow against the pinned library, so a record-shape change fails CI)
- [reviewed — clean] completion verification (phase 2, after replan): Verifier reran all gates (156 tests, 99.5% statements) and accepted criteria 1–11 with test evidence; 12 (owner connects) legitimately deferred. Advisories: no end-to-end chatgpt-client test; no unlisted client_id in a /token form body end to end; a lost OAUTH_KV client record with a surviving fingerprint is never re-provisioned (fails closed) (tier: reviewer floor — the interface is the one the replan approved)
- [solo] review triage (phase 2, after replan): 4 FIX / 0 SUGGEST / 0 IGNORE from the auth security review (tier: default-solo row — each finding had a concrete failure scenario and an absorbable fix, none had two defensible dispositions, none changes an approved interface). Supersedes the earlier [solo] client-provisioning line: the SHOP_KV marker plus `updateClient` design is replaced by a direct compare-and-put of the record
- [solo] phase 3 upload POST buffers one image (≤10 MB, content-length checked first) instead of streaming it to R2 (tier: solo — internal to the approved upload design; the 10 MB cap is enforced before the body is read, so memory stays far under 128 MB; magic-byte and dimension checks need the bytes anyway)
- [solo] phase 3 upload session keyed by listing (`upload-session:<listingId>` holding the nonce and an `r2Key → imageId` map), so `attach_uploaded_photos(listing_id)` needs no token (tier: solo — the tool signature is the approved one; a new request for the same listing replaces the old session)
- [solo] phase 3 photo rank comes from the R2 key position (0–9); Etsy uploads append with no rank sent (tier: solo — bounds the count without a counter; ordering still follows her chosen order)
- [solo] phase 3 `get_listing` reads with `includes=Images` (one call) instead of a separate getListingImages (tier: solo — fewer subrequests, same output)
- [solo] phase 3 `renew_listing` accepts expired, sold_out and inactive listings (tier: solo — all three become active through the same `state=active` write and fee preview)
- [solo] phase 3 `search_categories` filters the seller taxonomy tree client-side (tier: solo — Etsy has no search endpoint for it; one read)
- [solo] phase 3 Connecting outcome: not recorded — the owner hasn't reported the post-deploy connection result yet; the user guide keeps the placeholder and the final report asks for it (tier: solo — the proposal says Phase 3 doesn't wait on it)

- [reviewed — accept with fixes] completion verification (phase 3): Verifier reran all gates (290 tests, 99.4% statements) and mapped every Phase 3 criterion to a test; gaps folded as review FIXes: photos sent without `rank` (Etsy defaults to 1, so they'd land first in reverse), and the attach retry didn't skip recorded photos (tier: reviewer floor — no interface beyond what the proposal approved)
- [solo] review triage (phase 3): 11 FIX / 1 SUGGEST / 0 IGNORE (tier: default-solo row — each finding had a concrete failure scenario and an absorbable fix; the one SUGGEST, a download-host allowlist, needs ChatGPT's real file hosts, which only the live smoke run shows, and the image it guards against is removable with the gated remove_listing_image)
## Work notes — Phase 3 (2026-11-10)
- 27 tools (the proposal's list; the "about 35" estimate was high). `test/tools.test.ts` pins the exact set, annotations, and calls every tool once over the protocol.
- Bugs caught by tests while building: `fetchPages` didn't flag truncation when the cap landed exactly on `maxItems`; `get_views_trend` crashed on a corrupt snapshot (now skipped); an empty or non-numeric `content-length` passed the upload size check (now `/^\d+$/`).
- Typing helpers: `definedFields` strips undefined keys so form/query bodies satisfy `exactOptionalPropertyTypes`; the inventory PUT body is typed from the generated schema, so Etsy shape drift fails typecheck.
- Workers test pool: a `ScheduledController` can't cross `exports`, so the cron test imports the worker default and calls `scheduled` directly.
- Gates: all green, 290 tests in 24 files, gitleaks clean.

## Work notes — Phase 2 (2026-11-10)
- **MCP transport:** `@modelcontextprotocol/sdk` 1.32.2 `WebStandardStreamableHTTPServerTransport` in stateless JSON mode, with a fresh `McpServer` per request. No `agents` dependency, and no McpAgent DO.
- **workers-oauth-provider 1.2.4** does natively what the proposal planned to wrap:
  - `clientRegistrationCallback` enforces the redirect-URI allowlist;
  - audience is enforced against `resourceMetadata.resource`, and `handleMcp` still re-checks `ctx.auth.audience` as planned;
  - `beginConsent`/`approveConsent`/`denyConsent` give a browser-bound, unframeable consent form.
  - Its `beginUpstream`/`finishUpstream` keep `state` in KV (it's cookie-bound but not atomic), so the Etsy `state` + PKCE verifier stay in our `OneTimeStore` DO as designed, bound by our own `__Host-etsy-oauth-state` cookie.
- **Not needed:**
  - `COOKIE_SECRET`: the library's binding cookies are hash-bound, and our state cookie is compared against DO-held state.
  - CIMD: left disabled (library default); ChatGPT and Claude both use DCR.
- **Added:** `global_fetch_strictly_public`, so outbound fetch can't reach private addresses (it also silences the provider's CIMD warning).
- **Scopes:** derived from the spec, the set is `listings_d listings_r listings_w shops_r transactions_r transactions_w`. **`shops_w` is dropped**, because no planned tool needs it (the proposal's literal list was a guess; the derivation test is the authority).
  - `src/auth/etsy-scopes.ts` lists **every planned v1 tool**, so she grants once at first sign-in and never reconnects for Phase 3 tools.
  - Phase 3 must add a test that registered tools equal the table's tool keys (minus `sign_in` and `daily_views_snapshot`).
- **Grant revocation on a dead Etsy connection** happens in the tool layer (`withAccessToken` → `revokeUserGrants`), not inside the vault: the vault DO has no provider helpers. The vault clears itself and returns `reconnect`.
  - "Nothing stored" (`not_connected`) is treated the same way.
- **Runbook "revoke all grants"** is `scripts/revoke-all-grants.sh`, which bulk-deletes `grant:` and `token:` records from OAUTH_KV with wrangler. It does not call the provider API, because no admin route is exposed.
- **Logger** is `src/log/log-event.ts` (the filename matches its export), with a field allowlist. It is the only console carve-out.
- **Test infra:**
  - `@cloudflare/vitest-plugin` no longer exports `fetchMock` and no longer isolates storage per test. Tests spy on `globalThis.fetch` (the Worker and its DOs share the test isolate) and `test/support/setup.ts` calls `reset()` after each test.
  - The Etsy mock records request bodies eagerly, because a DO's request body can't be read from the test's context.
- **Config and lint:**
  - `wrangler types --strict-vars=false`: with literal var types, `ALLOWLIST_BOOTSTRAP === "true"` wouldn't typecheck.
  - `secrets.required` in wrangler.jsonc makes secret types deterministic.
  - `import-x/no-unresolved` ignores `@modelcontextprotocol/sdk/*.js`. The SDK's `./*` exports wildcard maps types to `*.js.d.ts`, which the resolver can't follow; tsc and the build gate still resolve those imports.
- **Deferred to Phase 3 (where first used):** `OneTimeStore.claim` (upload lease), R2, cron, and the Etsy client's price conversion between `{amount, divisor}` and decimals. The proposal lists the conversion under the Phase 2 Etsy client, but only Phase 3 tools use it, knip rejects unused code, and its round-trip test is a Phase 3 criterion.

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

## Review triage 2026-11-10 (phase 2)
Independent diff review plus the Verifier's gap, 6 findings:
1. REPLAN (high, user-directed): open DCR accepting Claude's/ChatGPT's shared callbacks lets anyone register a client and phish a grant. Replaced by the closed `MCP_CLIENTS` list (replan.md 2026-11-10).
2. FIX: deploy.yml could deploy a stale commit when CI runs finish out of order. It now deploys only when the CI head sha is still the tip of main.
3. FIX: the Cloudflare token was job-wide env. It is now scoped to the deploy step alone, and checkout uses `persist-credentials: false`.
4. FIX: key-ring parse errors and an unexpected tool error could echo secret material. They now use fixed messages, plus `tool_failed` / `vault_store_failed` log events with no detail.
5. REPLAN (user-directed): unauthenticated `/register` could exhaust the Free-plan KV write quota. It's gone with registration.
6. FIX (Verifier): the README first deploy would fail under `secrets.required`. It now uses `--secrets-file .dev.vars` in bootstrap mode, and `.dev.vars.example` defaults the allowlist to `unset`.

Auth security review of the replan commit (3caece9), 4 findings, nothing high:
7. FIX (medium): `ensureClients` ignored `updateClient`'s null result (a stale KV negative read right after the base put) and wrote its SHOP_KV marker anyway, which could leave a client with no secret for good. A lost OAUTH_KV record was never repaired either. Now: no marker. Each record is read and compared (secret hash, name, redirect URIs), then rewritten in one put when missing or different, so it repairs itself.
8. FIX (low): the gate split the Basic scheme on `\s` while the library splits on `[ \t]`. A `Basic<U+00A0>` header plus a body `client_id` let a removed-but-still-stored id past the gate (its tokens still failed at /mcp). The gate now mirrors the library's parser exactly and requires every claimed client_id (Basic and form body, all values) to be listed.
9. FIX (low): redirect URIs with a fragment or user info passed zod but made the library throw on every request (a 500, and it blocked later clients). zod now rejects them, and any sync failure answers the fail-closed 503 (`config_invalid`/`client_sync`).
10. FIX (low, docs): the ~60s KV propagation for a rotated secret, and running revoke-all-grants after removing a leaked client (re-adding the id would otherwise revive unexpired access tokens), are now in the README runbook.
Verifier advisories folded as tests: the ChatGPT client authenticates at /token, an unlisted body client_id is refused end to end, and a lost record is repaired.

## Review triage 2026-11-11 (phase 3)
Verifier gaps plus an independent diff review, 12 findings, nothing high:
1. FIX (Verifier, medium): uploads sent no `rank`, and Etsy's default is 1, so each new photo would take the main spot and her order would reverse. Ranks are now explicit (existing count + 1, incrementing) in attach and the fast path; `.minerva/reference/etsy-api.md` records the default.
2. FIX (both, medium): the attach loop re-sent any staged object, even one already recorded as on Etsy. It now skips and deletes those, and the upload POST refuses (409) a rank already on Etsy.
3. FIX (review, medium): a new upload link during an attach let the stale attach overwrite the new session (`update`) and then delete it (`consume`). `OneTimeStore.claim` now returns a lease id; `update`/`finish`/`release` act only for the current holder, and a `put` drops the lease, so the stale attach stops with "A new upload link replaced this one".
4. FIX (review, medium): `add_listing_image` buffered an unsized download whole. It now streams with a 10 MB cutoff (declared size still checked first).
5. SUGGEST (review, medium): the fast path fetches any public https URL, so a prompt injection (buyer message, review text) could get the model to add an attacker's image to a listing, ungated. Pin ChatGPT's file-download hosts once the live smoke run shows them. Until then: public-only fetch (`global_fetch_strictly_public`), JPEG/PNG and size checks, and the image can be removed.
6. FIX (review, low/medium): `update_listing_inventory` accepted an `offering_id` that isn't that product's and reported success for a no-op write. It is now refused before any write.
7. FIX (review, low): a photo that arrived after an attach claimed the session was orphaned while the page said "done". The upload re-peeks after the R2 put and takes the photo back with a 409.
8. FIX (review, low): `update_listing` could turn auto-renew on, committing her to a fee each renewal, without confirmation. It now accepts only `false`.
9. FIX (review, low): sales "revenue" summed `grandtotal` (tax included) and counted refunded orders. Now: item sales (`subtotal`), shipping and partial refunds per currency, fully refunded orders left out and counted; refund notes and reasons never leave the server.
10. FIX (review, low): 429 retries could push past Workers Free's 50 subrequests and crash the cron. Each invocation now shares a 45-request Etsy budget that retries draw from, and a 429 after the first page ends a multi-page read as truncated, keeping the pages read.
11. FIX (review, low): the renew preview now says a sold-out listing's quantity becomes 1.
12. FIX (Verifier, optional): a second visit to the link restarting at rank 0 can't duplicate photos any more (covered by #2); the user guide says to ask again rather than re-upload.

## Mode B promotions (phase 1)
- import-x resolver/parsers constraint → promoted to .minerva/knowledge/2026-11-10-constraint-import-x-needs-typescript-resolver-and-parsers.md
- self-pinning gates pattern → promoted to .minerva/knowledge/2026-11-10-pattern-gates-pin-themselves.md
- toolchain version pins (TS 5.9, vitest-plugin, wrangler types, unicorn rename, allowScripts) → promoted to .minerva/knowledge/2026-11-10-constraint-toolchain-version-pins.md
