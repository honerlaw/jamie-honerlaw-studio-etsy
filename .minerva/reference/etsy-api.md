# Etsy Open API v3 — operational facts

Present-tense facts this server depends on. Gathered 2026-11-10 from Etsy's developer docs and the OpenAPI spec (snapshot: `etsy/openapi.json`, spec version 3.0.0). The sources are listed in `docs/research/etsy/README.md`.

## Authentication
- **Every request** sends `x-api-key: <keystring>:<shared_secret>`. A bare keystring gets a 403 (confirmed with a live call during research). See the shared-secret format change: https://github.com/etsy/open-api/discussions/1521
- User auth is **OAuth 2.0 authorization code with PKCE only** (S256).
- **Access tokens last 1 hour. Refresh tokens last 90 days.** Every refresh returns a **new** refresh token, so the newest one must always be persisted. Losing a rotation means she has to log in again.
- Scopes the server needs: `listings_r listings_w listings_d transactions_r transactions_w shops_r shops_w`. Each operation's required scopes are in the spec's `security` annotations.
- **Access tier:** the Seller App tier (announced July 2026, https://github.com/etsy/open-api/discussions/1647) covers only the developer's own shop and is approved automatically within minutes.

## Data shapes and semantics
- **Prices** come back as `{amount, divisor, currency_code}` (e.g. `{amount: 3400, divisor: 100}` = 34.00) but are **sent** as a plain decimal number.
- **Inventory updates replace the whole inventory** (`updateListingInventory`). Always read it, edit it and write it all back. Products and offerings you leave out are deleted.
- `createDraftListing` requires `quantity, title, description, price, who_made, when_made, taxonomy_id`.
- **Publishing:** draft → upload images → `updateListing` with `state=active`. A physical listing also needs a shipping profile, a processing profile (readiness state) and a return policy.
- **Fees:** activating or renewing a listing most likely charges Etsy's standard listing fee (currently $0.20). The API docs don't state it, so treat it as fee-bearing.
- **EU product-safety (GPSR) fields** (`gpsr_*`) on listings become **required on 2027-02-01**.
- **Images:** `uploadListingImage` takes `multipart/form-data` (`image`, `rank`, `overwrite`, `alt_text`, …).

## What the API cannot tell us
- **No stats or traffic data:** no visits, no search terms, no conversion rate.
- Available instead: lifetime `views` per listing (updated daily), favorites (`num_favorers`), reviews, and revenue from receipts, transactions, payments and the payment-account ledger.
- A views trend over time needs our own daily snapshots.

## Limits
- Rate limits are per app (QPS and QPD). On a 429, honour `Retry-After`. See https://developer.etsy.com/documentation/essentials/rate-limits
- Spec: https://www.etsy.com/openapi/generated/oas/3.0.0.json (no auth needed). It has 107 operations.
