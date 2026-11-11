# Proposal: etsy-shop-mcp-server

**Date**: 2026-11-10
**Status**: Draft

## Goal
A remote MCP server that lets one Etsy seller (the owner's wife) run her own shop by chatting in Claude, ChatGPT or another MCP client, on the web or her phone. It covers listings (including photos, publishing and renewing), orders and shipping, inventory and pricing, and shop insights.

It is built in a TypeScript repo whose gates are extremely strict and block every PR until they pass: type-check, lint (including `@onerlaw/agentic-eslint-plugin`), format, dead-code, test-with-coverage, build and secret-scan. Those gates are in place **before any product code is written**.

## Why
Managing an Etsy shop from a phone today means the Etsy Seller app's forms, one screen at a time. A conversational client can do multi-step jobs in one request ("draft a listing from these photos, use my usual shipping profile, price it at $34"). Etsy's Open API v3 Seller App tier (July 2026) is approved automatically and covers exactly one shop.

The code will be written mostly by agents. The owner wants mechanical gates that stop type holes, unsafe `any`, floating promises, unexplained lint suppressions, unused code and committed credentials from merging, regardless of who or what wrote the code.

## Approach

### Stack and why
- **TypeScript (strictest) on Cloudflare Workers.** The deciding reason is `@cloudflare/workers-oauth-provider`. It implements the OAuth 2.1 authorization-server side that ChatGPT and Claude require: PKCE S256, dynamic client registration, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` metadata, and bearer-token validation on the API route. Hand-rolling that would be the riskiest code in the project. The owner already has Cloudflare, an Etsy developer app and paid ChatGPT. Expected cost: Workers Free plan (SQLite-backed Durable Objects, KV, R2 and Cron are all on it). Enabling R2 needs a payment method on file, though usage stays inside the free tier. Worst case is Workers Paid at $5/month.
- **MCP transport:** the Cloudflare `agents` `McpAgent` (Streamable HTTP at `/mcp`), mounted as the OAuth provider's `apiHandler`. Tools are registered with `@modelcontextprotocol/sdk`, using the `zod` major version it requires. All three are added in Phase 2.
- **CPU time:** Workers Free allows 10 ms of CPU per request (waiting on I/O doesn't count). Hashing, AES-GCM on a small record and streaming pass-through fit inside that. Image bytes are streamed, never decoded or re-encoded, on the server. If production logs show CPU-limit errors, the fallback is Workers Paid ($5/month, 30 s of CPU), and the README says so.
- **Typed Etsy client:** `openapi-typescript` (a dev dependency, used by the `gen:etsy-types` and `check:etsy-types` scripts from Phase 1) generates **type-only** `src/etsy/generated/schema.ts` from a committed snapshot `etsy/openapi.json`, and `openapi-fetch` makes the typed calls. Etsy's spec is known to be imperfect, so responses on the critical paths are also **`zod`-parsed** at runtime: token exchange and refresh, `getMe`, inventory and receipts. Every tool's input is `zod`-validated.
- **Rejected alternatives:**
  - **(A)** Etsy tokens inside the grant `props`, refreshed by `tokenExchangeCallback`. Props are fixed per issued MCP token, and the callback runs only when the MCP client refreshes. Etsy refresh would be tied to the client's token lifecycle, nothing could refresh in the background (the daily cron needs to), and parallel client refreshes could each rotate the Etsy refresh token, so one rotation would be lost.
  - **(C)** A Node server on a VPS with a hand-rolled or `oidc-provider` authorization server plus Postgres. That means more security code to own, more infrastructure, and a harder CI story.
  - The cost of the chosen design (B) is two Durable Object classes beyond McpAgent's own: `EtsyTokenVault` and `OneTimeStore`. All three are declared with migrations in `wrangler.jsonc`, and `src/index.ts` exports them, which makes them knip entries.

### Strict toolchain (Phase 1, before any product code)
- **`tsconfig`:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames` and `allowJs: false`. `exactOptionalPropertyTypes` will clash with some library types. The budget is to adapt at our boundary and never to weaken the flag.
- **ESLint 9 flat config** (`eslint.config.ts`), run with `--max-warnings 0`:
  - `eslint.config.ts` loads through `jiti`, which is a dev dependency.
  - `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked` via the project service.
  - Plus: `no-explicit-any`, `explicit-module-boundary-types`, `switch-exhaustiveness-check`, `strict-boolean-expressions`, `no-floating-promises`, `no-misused-promises`, `consistent-type-imports`, `no-non-null-assertion`, `prefer-readonly`, `eqeqeq`, `no-param-reassign`, `no-restricted-syntax` (bans TS `enum` and `namespace`), `max-lines` (300, skipping blank lines and comments) and `no-console`.
  - `@eslint-community/eslint-plugin-eslint-comments`: `require-description`, `no-unlimited-disable`, `no-unused-disable` and `disable-enable-pair`.
  - `eslint-plugin-import-x`: `no-cycle`, `no-extraneous-dependencies` and `no-default-export`. The resolver treats `cloudflare:*` as core modules.
  - `eslint-plugin-unicorn` correctness rules: `no-array-for-each`, `no-useless-promise-resolve-reject`, `prefer-node-protocol`, `throw-new-error`, `no-thenable`, `no-instanceof-builtins`, `error-message`, `prefer-type-error`.
  - **`@onerlaw/agentic-eslint-plugin`** (npm 0.2.0, registered under the plugin namespace `agentic`) gets one config block per rule, as its README requires. `no-credential-in-url` covers all TS and config files. `one-export-per-file` covers `src/**`. Its stack-specific rules (Tamagui, Connect-RPC, markdown, workspace, token floor) don't apply and are left off on purpose.
  - **Named carve-outs** (each block carries a comment saying why):
    - `src/index.ts` may `export default` the Worker and export the Durable Object classes, as Workers requires.
    - `src/log/logger.ts` is the only file allowed to use `console`.
    - `src/etsy/generated/**`, `etsy/openapi.json`, `docs/research/**` and `tests/lint-fixtures/**` are excluded from ESLint's main run, Prettier, knip and coverage.
    - The generated file **is** included in `tsc`, because it is types that must compile.
- **Other gates:**
  - `prettier --check`.
  - `knip` for unused files, exports and dependencies. `knip.json` names `src/index.ts`, the test files, `eslint.config.ts`, `vitest.config.ts` and the `scripts/` as entries. **Dependencies are added in the phase that first uses them** (Phase 1 installs no `agents`, `workers-oauth-provider`, `openapi-fetch` or `zod`), so knip never needs a dependency exemption.
  - `tsc --noEmit`.
  - **gitleaks** scans the full git history in CI.
  - GitHub secret scanning and push protection are enabled on the repo (free for public repos).
- **Tests:**
  - One `vitest.config.ts` with two **projects**. `npm test` runs both.
    - `workers`: `@cloudflare/vitest-pool-workers`, the real workerd runtime, for every test of `src/`. Etsy is mocked with `fetchMock`.
    - `node`: plain Node, for repo-level tests such as the lint gate (it loads `eslint.config.ts` through `jiti`) and the CI-structure check (it parses YAML with the `yaml` dev dependency).
  - Coverage is collected from the `workers` project only, over all of `src/`, `src/index.ts` included, minus `src/etsy/generated/**`. It uses `@vitest/coverage-istanbul` (workerd has no `node:inspector`, so v8 coverage is out).
  - Thresholds are **global 90% lines and 90% branches, plus a per-file floor of 80%** (so one weak file can't hide behind the average), from Phase 1 onward. Like the tsconfig flags, they are **never lowered**, and coverage exclusions are limited to generated code. Hard-to-reach branches (crypto failures, storage failures) are reached through injectable interfaces such as `VaultStorage` and the clock, not excluded.
  - `vitest`, the pool, `wrangler` and `@cloudflare/workers-types` are chosen as one compatible set and pinned exactly.
- **Build gate:** `wrangler deploy --dry-run --outdir dist`. Phase 1 ships a minimal `wrangler.jsonc` (name, `main`, `compatibility_date`, `compatibility_flags`) that both the build and the test pool use. Phases 2 and 3 extend it with bindings.
- **Gate integrity:** with 0 approvals, nothing but the gates reviews an agent PR, so the gates must not be quietly loosened. `tests/gate-integrity.test.ts` (in the `node` project) pins them:
  - every tsconfig flag listed above;
  - `--max-warnings 0` in the `lint` script;
  - the coverage thresholds (≥ 90 global, ≥ 80 per file);
  - the `ci-pass` needs set;
  - the ruleset JSON's `deletion`, `non_fast_forward`, `required_status_checks: [ci-pass]` and empty `bypass_actors`;
  - that every `eslint.config.ts` rule this proposal names resolves to `error` (via `ESLint.calculateConfigForFile`).

  Loosening a gate therefore means visibly editing this test in the same PR.
- **CI:** `.github/workflows/ci.yml` runs on `pull_request` and on `push` to `main`, on Node pinned by `.nvmrc`, using `npm ci`.
  - Jobs: `typecheck`, `lint`, `format`, `knip`, `test` (with coverage), `build`, `etsy-types-match-snapshot` (regenerates the types from the committed snapshot and fails on any diff) and `secret-scan`.
  - No job is path-filtered or conditional, so none can legitimately report `skipped`.
  - An aggregate `ci-pass` job uses `if: always()` and fails unless every needed job's `result` is `success`.
  - `tests/ci-structure.test.ts` (in the `node` project) parses `ci.yml` and asserts that `ci-pass.needs` equals the set of all other job ids, so a job added later can't escape the gate.
  - A separate weekly `etsy-spec-drift.yml` fetches the live Etsy spec and opens or updates an issue when it differs from the snapshot. It is not part of `ci-pass`.
  - Dependabot opens grouped weekly PRs for npm and Actions. `wrangler`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types` and `vitest` share one group so they always move together. Pins stay exact, and every upgrade goes through the same gate.
- **Branch protection as code:** `.github/rulesets/main.json` plus `scripts/apply-ruleset.sh` (it runs `gh api` and is idempotent). The ruleset targets `main`, requires a PR with 0 approvals (solo repo), requires the `ci-pass` status check, blocks force-pushes and deletion, and has no bypass actors. It is applied **during Phase 1's ship, before merge**: once the PR's first CI run has created the `ci-pass` check name, the agent runs the script with the owner's authenticated `gh`. So Phase 1's own merge is already gated.
  - **Break-glass:** `scripts/apply-ruleset.sh --disable` sets the ruleset to `disabled` and `--enable` restores it. The README documents this as the only override, for a broken CI provider and never for a failing check.
  - The repo also gets auto-merge and delete-branch-on-merge. With 0 required approvals and auto-merge, **the gates are the only review an agent PR gets**. That is deliberate, and it is why thresholds and lint settings are never lowered.
- **Agent guidance:**
  - `AGENTS.md` gains a "Project conventions" section listing the gate commands and the rules that suppressions need descriptions and that strict flags are never weakened.
  - `CLAUDE.md` contains `@AGENTS.md`, so Claude Code reads the same file.

### Auth and security model (Phase 2)
- **MCP client ↔ server:** `workers-oauth-provider` is the authorization server. **Where the library doesn't provide a check natively, we wrap it:** our Worker's `fetch` handles `/register` before delegating, to enforce the redirect-URI rule, and our `apiHandler` re-checks the token's audience against the `/mcp` resource. The Phase 2 tests fail if either check is missing, whichever layer provides it. If ChatGPT registers through a client-metadata-document URL instead of DCR, the same redirect-URI rule is applied to the fetched document. Dynamic client registration is public, but it is **restricted by redirect URI**. A registration is accepted only if every `redirect_uri` exactly matches the `ALLOWED_REDIRECT_URIS` list. That list defaults to ChatGPT's and Claude's documented connector callbacks (`https://chatgpt.com/connector_platform_oauth_redirect`, `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) and can be extended by a var. Anything else gets a 400. So a rogue client can't phish a grant to its own endpoint by calling itself "Claude". The Etsy allowlist below is the second layer: it stops anyone other than her.
- **Single-use state lives in a Durable Object, never KV.** KV is eventually consistent and has no compare-and-swap, so a "delete then reject replays" check can be beaten across edge locations. One `OneTimeStore` DO stores the OAuth `state`, upload nonces and confirmation tokens, each with a TTL. `consume(key)` atomically returns and deletes the entry, so it succeeds exactly once.
- **`/authorize` (our handler):**
  1. Parse the MCP auth request and show a minimal **approval page** naming the requesting client (`client_name` and the redirect host).
  2. On approval (CSRF-protected by a `__Host-` cookie), create a random `state` and an Etsy PKCE verifier.
  3. Store `{mcpAuthRequest, verifier}` in `OneTimeStore` under `state` with a 10-minute TTL, set a `__Host-` cookie binding that `state` to the browser, and redirect to Etsy OAuth (S256).
  4. Request only the scopes the tools need. The list is **derived**: a `src/etsy/scopes.ts` table maps each tool to the Etsy operations it calls. A test checks that the union of those operations' `security` scopes in `etsy/openapi.json` equals the requested set, so a tool added in Phase 3 that needs a new scope fails CI rather than failing at runtime. The expected set is `listings_r listings_w listings_d transactions_r transactions_w shops_r shops_w`.
- **`/callback`:**
  1. Requires the cookie's `state` to match, then calls `OneTimeStore.consume(state)` (atomic single use). An unknown, mismatched or replayed `state` gets a 400.
  2. Exchanges the code and calls `getMe`.
  3. **Allowlist:** completes the MCP authorization only if both `user_id` and `shop_id` equal the `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID` secrets. On a mismatch it returns 403, creates no grant and **never writes the vault**.
  4. If the allowlist secrets are unset, it **fails closed** with a 403.
- **Bootstrap (finding her ids):** only when the `ALLOWLIST_BOOTSTRAP` var is `"true"` (off by default) does the callback **display** her `user_id` and `shop_id` on the response page. Even then it issues no grant, stores no tokens and logs nothing. The README tells the owner to set the two secrets and then turn bootstrap off.
- **`EtsyTokenVault` Durable Object** (one instance, keyed by the allowlisted shop id):
  - **Refresh serialization:** a Durable Object's input gate does **not** cover an outbound `fetch`, so other requests can interleave while a refresh is in flight. The vault therefore memoizes a single **in-flight refresh promise**: concurrent `getAccessToken()` callers await the same refresh, and the token state is re-checked after every `await`.
  - The access token refreshes when it has less than 5 minutes left. The new access and **rotated** refresh tokens are persisted in **one** `storage.put` before the access token is returned.
  - **Encryption (defence in depth on top of Cloudflare's at-rest encryption):** AES-GCM-256 with a random 12-byte IV per write and AAD = shop id. Ciphertext is prefixed with a key id (`TOKEN_ENC_KEYS` is a JSON map of kid to key, and `TOKEN_ENC_KID` is the current kid), so keys can rotate: the vault decrypts with any listed key and re-encrypts with the current one. A lost key means she reconnects.
  - **Dead refresh token** (Etsy `invalid_grant`, revoked, or expired after 90 days): the vault clears its record, every grant for her user is revoked through the provider's grant API, and the tool returns the error "Etsy connection expired — open the connector settings and reconnect". With the grant gone, the client's next call gets a 401 and it re-runs authorization.
  - A re-login overwrites the single vault record.
  - **Accepted data-loss window:** if the Worker dies between Etsy returning a rotated refresh token and the `storage.put`, the rotation is lost and Etsy has already invalidated the old token. The next call then takes the `invalid_grant` path and she reconnects once. Storage is reached through an injectable `VaultStorage` interface, so this path is unit-tested.
  - Grant props carry only `{etsyUserId, shopId}`, never tokens.
- **Etsy client:**
  - Sends `x-api-key: ${ETSY_KEYSTRING}:${ETSY_SHARED_SECRET}` on every request.
  - Converts prices between `{amount, divisor}` and decimals.
  - Honours 429 `Retry-After`, up to 2 retries.
  - Maps Etsy errors to readable tool errors that **never include response bodies containing PII**.
- **Buyer PII policy:**
  - Order tools return the buyer's first name, the order contents, and the ship-to city, region and country. `get_order` returns the full shipping address only with `include_address: true`.
  - Buyer email, phone and messages are never returned.
  - The logger has a redaction allowlist (only listed fields are ever logged) and never logs request or response bodies.
- **Secrets (Wrangler secrets, plus `.dev.vars` locally, which is gitignored; `.dev.vars.example` is committed):** `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, `ALLOWED_ETSY_USER_ID`, `ALLOWED_ETSY_SHOP_ID`, `TOKEN_ENC_KEYS`, `TOKEN_ENC_KID`, `COOKIE_SECRET`, and in Phase 3 `UPLOAD_SIGNING_KEY`. **Vars:** `ALLOWLIST_BOOTSTRAP` and `ALLOWED_REDIRECT_URIS`.
- **Deploy:**
  - `wrangler.jsonc` declares the DO classes with their migrations, the KV namespace (`OAUTH_KV`), and in Phase 3 the R2 bucket and the cron trigger.
  - `.github/workflows/deploy.yml` deploys `main` after CI passes when the `CLOUDFLARE_API_TOKEN` repo secret exists, and skips with a notice otherwise.
  - `npm run deploy` works locally too.
- **Runbook (README):** how to revoke all grants (a script that calls the provider's grant API), rotate each secret, rotate `TOKEN_ENC_KEYS`, and what to do if her phone is lost.

### Tools (Phase 3), one typed tool per job she needs
- **Shop:** `get_shop_overview` (shop details plus connection health: the vault's token age and the last cron run's status, or `not yet run`), `list_shop_sections`, `list_shipping_profiles`, `list_processing_profiles`, `list_return_policies`, `search_categories` (seller taxonomy).
- **Listings:** `list_listings` (by state), `get_listing`, `create_draft_listing`, `update_listing`, `request_photo_upload`, `attach_uploaded_photos`, `add_listing_image`, `remove_listing_image`, `publish_listing`, `renew_listing`, `deactivate_listing`, `delete_listing`.
- **Inventory & pricing:** `get_listing_inventory` and `update_listing_inventory`. The server does the read-modify-write and accepts a partial patch (price, quantity or SKU per product/offering), because Etsy replaces the whole inventory on every write.
- **Orders & shipping:** `list_orders` (filters: unshipped, paid, date range), `get_order` and `mark_order_shipped` (tracking code and carrier).
- **Insights:**
  - `get_sales_summary`: revenue, order count and top listings over a date range, from receipts and transactions.
  - `get_listing_stats`: lifetime views and favorites.
  - `list_reviews`.
  - `get_views_trend`: computed from our own snapshots.
  - A **daily cron** reads views through the paginated `getListingsByShop` (`state=active`, 100 per page, since the listing object carries `views`). It writes **one** KV key per day (`views:YYYY-MM-DD` holding a JSON map of listing id to views), so a shop of a few hundred listings costs a handful of subrequests and one KV write. It also refreshes the Etsy token so the refresh token never idles out, and records `{ranAt, ok, error}` to KV, which `get_shop_overview` surfaces.
  - **Subrequest budget:** Workers Free allows 50 subrequests per invocation. Every multi-page tool (`get_sales_summary`, `list_orders`, the cron) has a page cap that keeps it under 40 subrequests. When the cap is hit, the result says the data was truncated, never silently. Tools take at most one listing's inventory per call. Shops above roughly 3,000 active listings, or longer sales ranges, would need Workers Paid ($5/month), and the README says so.
- **Confirmation gate** (the owner's choice: costly or destructive only):
  - Gated tools: `publish_listing` and `renew_listing` (both charge Etsy's listing fee, currently $0.20), `deactivate_listing`, `delete_listing`, `remove_listing_image`, and `mark_order_shipped` (it emails the buyer and can't be undone).
  - A gated tool has no `confirm: true` shortcut, because the model could simply send it. The **first** call always returns a **preview** of the change and any fee, plus a `confirmation_token`. The token is a random 128-bit id stored in `OneTimeStore` as `{tool, argsHash}` with a 10-minute TTL. The store is the only authority, so no HMAC is needed. `argsHash` is SHA-256 over the RFC 8785 (JCS) canonical JSON of the **zod-parsed** arguments with defaults applied and the token field removed, so key order and omitted defaults don't change it. Building a preview uses at most 2 Etsy reads.
  - The write happens only on a second call that carries that token with **identical** arguments, and the token is consumed atomically.
  - The tool description tells the model to show her the preview and ask before the second call. That can't be forced server-side, but the two-step flow guarantees a preview exists and that the confirmed write is exactly what was previewed.
  - Other writes run directly.
  - Every tool sets MCP annotations (`readOnlyHint` and `destructiveHint`).
- **Photos (research, 2026-11-10):** neither ChatGPT mobile nor Claude reliably passes a photo attached in chat to a custom MCP tool. ChatGPT's `openai/fileParams` works on web but sends a placeholder string on iOS and Android (openai-apps-sdk-examples#185, still open). Claude has no channel for it, and base64 arguments corrupt the image. So:
  - `request_photo_upload(listing_id)` returns an HTTPS link to an **upload session**. The token is an HMAC under `UPLOAD_SIGNING_KEY` bound to the shop, the listing and a nonce, and it expires after 30 minutes.
    - The token travels in the URL **fragment** (`/upload#t=…`), so it is never sent in a request line or a `Referer` header.
    - The nonce lives in `OneTimeStore`. The session can be used until it is **consumed atomically by `attach_uploaded_photos`** or expires. Because the link sits in chat history, it is short-lived and single-session.
  - **Upload page:**
    - Served by the Worker with a strict CSP (`default-src 'none'`, plus its own inline-hashed script and style), `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and no third-party scripts.
    - The upload `POST` requires the token in an `Authorization` header and a same-origin `Origin`. A cross-site form can't set that header, which gives CSRF safety.
    - `<input type="file" accept="image/*" multiple>` lets her use the camera or her photo library.
    - Images are downscaled in the browser to at most 3000 px and re-encoded as JPEG (this handles HEIC).
    - She can reorder the photos.
    - Each image is POSTed with the token in a header.
  - **Server-side checks:** at most 10 images per session and at most 10 MB each. JPEG/PNG magic bytes are required, and the header dimensions are parsed and rejected above 6000 px a side. Each request is **streamed** to R2 one image per request, never buffered as a batch, which keeps it inside the 128 MB Worker memory limit. Images are staged in **R2** under `uploads/<nonce>/`, and an R2 lifecycle rule deletes leftovers after 1 day.
  - `attach_uploaded_photos(listing_id)` first takes an exclusive **lease** on the session (`OneTimeStore.claim(nonce, 120 s)`), so a concurrent second attach fails. It then streams each staged image that isn't yet recorded as uploaded to Etsy `uploadListingImage` (multipart, ordered by `rank`), recording `r2Key → listing_image_id` in the session after each success and deleting that staged object.
    - When every image has gone through, it consumes the session.
    - On a mid-way Etsy failure it releases the lease and reports which photos went through. Retrying within the session's 30 minutes uploads only the rest, with no duplicates.
  - **Fast path:** `add_listing_image` declares `_meta["openai/fileParams"]`. A real `{download_url}` object (ChatGPT web) is fetched immediately and uploaded. A placeholder string (mobile) gets the upload link instead.
- **Metrics honesty:** the descriptions of `get_sales_summary` and `get_listing_stats`, and the user guide, say up front that the Etsy API has no visits, search terms or conversion data.

### Docs
- `.minerva/reference/etsy-api.md`: Etsy facts from the handoff. Covers the key header, token lifetimes and rotation, the price shape, inventory replace semantics, publishing prerequisites and fees, the GPSR fields required on 2027-02-01, and rate limits.
- `docs/research/etsy/`: the raw research. Before it is committed, gitleaks is run on it and it is grepped for `x-api-key`, `keystring` values, `Bearer ` and email addresses. These were public doc pages plus a no-auth spec fetch, and any hit is removed first. During Phase 1 the agent copies it into the branch from the untracked holding directory `.minerva/worktrees/_research/etsy/` in the primary checkout, and the spec becomes `etsy/openapi.json`. Once committed, a clean checkout needs nothing outside the repo.
- `README.md`: Etsy app callback setup, secrets, bindings, deploy, connecting Claude and ChatGPT, and the runbook.
- `docs/user-guide.md`: a plain-language guide for the seller. Phase 2 creates it with connection instructions, and Phase 3 completes it with the tools and the metrics section.

## Success criteria
The criteria are listed per phase under `## Phases` below, and the unit is done when every phase's criteria hold. Each criterion is checked by a named test, a command's exit code or a `grep`. The exception is the Phase 1 ruleset criterion, which an owner-authenticated `gh api` call checks.

## Phases
1. **Strict toolchain + CI gate + Worker skeleton** — everything under "Strict toolchain", a Worker serving `GET /health`, the moved research and spec snapshot, the generated types, `.minerva/reference/etsy-api.md`, the AGENTS.md conventions and `CLAUDE.md`.
   - `npm ci && npm run typecheck && npm run lint && npm run format:check && npm run knip && npm test && npm run build && npm run check:etsy-types` exits 0 on a clean checkout, with the coverage thresholds enforced.
   - **Lint-gate test** (`tests/lint-gate.test.ts`, run in a Node vitest project): it lints `tests/lint-fixtures/bad.ts` using the repo's `eslint.config.ts` with fixture ignores lifted, and with type information for the fixture. It asserts these exact ruleIds are reported: `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-floating-promises`, `@eslint-community/eslint-comments/require-description` and `agentic/no-credential-in-url` (the fixture URL `https://user:secret@api.etsy.com`). It also asserts that `tests/lint-fixtures/good.ts` reports zero messages, because `good.ts` is written to satisfy the **full** strict rule set (one exported function, under `max-lines`, fully typed). A third fixture, `reexports.ts`, re-exports two functions from two other modules. The test pins how `agentic/one-export-per-file` treats re-exports, so `src/index.ts`'s carve-out is known to be needed or not before Phase 2 relies on it.
   - `GET /health` returns 200 `{ok:true}` in a workerd test.
   - `.github/workflows/ci.yml` defines `ci-pass` with `if: always()` and a `needs.*.result` check. `tests/ci-structure.test.ts` passes, meaning `ci-pass.needs` equals all other jobs. `ci-pass` is green on this phase's PR.
   - After `scripts/apply-ruleset.sh` runs, `gh api repos/{owner}/{repo}/rulesets` lists an active ruleset whose rules include `required_status_checks` naming `ci-pass` and `pull_request`, and `non_fast_forward`. The agent's `gh` is authenticated as the repo owner (admin), so the agent checks this itself, and **Phase 1 is not reported shipped until it holds**.
2. **OAuth, allowlist, token vault, typed Etsy client, deploy** — everything under "Auth and security model", plus one end-to-end tool, `get_shop_overview`, so the owner can connect Claude and ChatGPT (including from her phone).
   - Both well-known metadata documents are served, and the authorization-server metadata lists `S256` in `code_challenge_methods_supported`. Dynamic client registrations shaped like ChatGPT's and Claude's (their documented redirect URIs) succeed. Library behaviour is verified against the exactly pinned `workers-oauth-provider` version by these tests rather than assumed.
   - `/mcp` without a token gets a 401 with a `WWW-Authenticate` header. Tokens that are expired, have the wrong audience/resource, or are malformed get a 401. A token request without a PKCE verifier, or with the wrong one, is rejected.
   - Client registration with a `redirect_uri` outside `ALLOWED_REDIRECT_URIS` → 400.
   - `OneTimeStore.consume` returns the entry once, then nothing. That holds under concurrent calls and after expiry.
   - The callback: unknown or replayed `state` → 400. Allowlist mismatch → 403, no grant, no vault write. Allowlist secrets unset → 403. Match → authorization completes.
   - Bootstrap: with `ALLOWLIST_BOOTSTRAP` unset the ids are never shown. With it set, they are shown and no grant or vault write happens.
   - Vault: N concurrent `getAccessToken()` calls against a delayed refresh mock cause exactly **1** Etsy refresh. The rotated refresh token is persisted. The stored record contains neither token in plaintext. A record encrypted under an old kid decrypts and is re-encrypted under the current kid. `invalid_grant` clears the record, revokes the grants and yields the reconnect error. A unit test over an injected `VaultStorage` whose `put` throws after a successful refresh shows the old record left intact and the next call (Etsy answering `invalid_grant`) taking the reconnect path, never a half-written state.
   - Every mocked Etsy request carries `x-api-key: <keystring>:<secret>`.
   - `get_shop_overview` returns shop data through mocked Etsy, and reports `cron: not yet run` when no cron status is recorded.
   - The scope-derivation test passes.
   - `wrangler.jsonc` and `deploy.yml` exist, and the build gate passes with them. `docs/user-guide.md` exists, with a `## Connecting` section.
   - **Not a merge gate:** after merge, the owner deploys and connects Claude and ChatGPT on web and phone. The agent then records the outcome the owner reports in the user guide's `## Connecting` section, as the first commit of Phase 3. Phase 3 doesn't wait for it, because no Phase 3 design choice depends on the result.
3. **Shop tools + photo upload + insights snapshot + docs** — everything under "Tools", plus the README and user guide.
   - A `tools/list` test asserts the exact tool set above, and that each tool has `readOnlyHint` and `destructiveHint` annotations.
   - For each gated tool (fetchMock call counts):
     - First call → a preview plus `confirmation_token`, and **0** Etsy write calls.
     - Second call with the token and identical arguments → exactly the expected write.
     - A token with changed arguments, an expired token, a reused token, or no token → rejected with 0 writes.
     - The same arguments with reordered keys, or with defaults omitted versus spelled out, hash equal.
     - A preview makes at most 2 Etsy reads.
   - `update_listing_inventory` writes untouched products and offerings back byte-for-byte equal to what it read.
   - Price round-trip tests between `{amount, divisor}` and decimals.
   - PII: `list_orders` output has no buyer email or street address. `get_order` includes the address only when `include_address: true`. Logger redaction tests pass.
   - Upload:
     - Tokens that are expired, tampered or already consumed are rejected.
     - Over-count, over-size, over-dimension and non-image (bad magic bytes) uploads are rejected.
     - Upload POSTs with a cross-origin `Origin` are rejected.
     - The upload page response carries the stated CSP, `Referrer-Policy: no-referrer` and `X-Frame-Options` headers.
     - Two concurrent `attach_uploaded_photos` calls produce exactly one set of Etsy uploads. An attach that fails on image 3 of 5, then retried, uploads only images 3–5, and no image twice. Valid uploads land in R2 under `uploads/<nonce>/`. `attach_uploaded_photos` sends multipart uploads in `rank` order, then deletes the staged objects and consumes the nonce. The `add_listing_image` fast path fetches a `download_url` object and returns the upload link when given a string.
   - The cron handler pages `getListingsByShop`, writes exactly one `views:YYYY-MM-DD` key, refreshes the token and records its status.
   - Multi-page tools stop at their page cap and report truncation (a test with a mock that returns more pages than the cap). `get_views_trend` computes deltas from the snapshots.
   - `grep -q "^## What the numbers can't show" docs/user-guide.md` succeeds, and that section names visits, search terms and conversion rate.
   - The coverage thresholds still hold.
   - **Not a merge gate:** after merge, the owner runs a live smoke checklist from `docs/user-guide.md` (`## First run checklist`): draft a listing, add photos through the upload link, update one inventory price, publish with confirmation, list today's orders, and check `get_shop_overview` after the first cron run. Anything that fails becomes a fix PR.

## Open Questions
- **Phase 3 size:** it is the largest phase, about 35 tools plus uploads and the cron. If its diff gets too big to review well, it may ship as stacked sub-PRs (tools by area) under the same phase. The criteria are the same either way.
- **Etsy rate limits:** handled by 429 `Retry-After` retries and page caps, with no dedicated QPS criteria. That's acceptable for one seller, and noted as a known gap.
- **ChatGPT plans and mobile write actions:** OpenAI's pages conflict. Some say write-capable custom MCP needs Business, Enterprise or Edu, with Plus and Pro limited to read. Others say Plus works in developer mode. Community reports say mobile disables write actions. Claude custom connectors work on mobile on all plans, so **Claude is the guaranteed client**. The Phase 2 post-merge check settles what ChatGPT allows on her plan.
- **Renewal fee:** the preview states it as "Etsy's standard listing fee (currently $0.20)" rather than a guaranteed amount.
