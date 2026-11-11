# Etsy shop MCP server

A remote [MCP](https://modelcontextprotocol.io) server that lets one Etsy seller manage her shop by chatting in Claude, ChatGPT or another MCP client. It runs on Cloudflare Workers.

**Status:** v1 complete: 27 tools covering listings (with photos), inventory and pricing, orders and shipping, and shop insights, plus a daily views snapshot. The design is in `.minerva/work/2026-11-10-etsy-shop-mcp-server/proposal.md`, and the seller's guide is `docs/user-guide.md`.

## How it fits together

- **MCP clients (Claude, ChatGPT) ↔ this Worker:** `@cloudflare/workers-oauth-provider` is the authorization server (PKCE S256, discovery documents, token checks). It's a closed list with no sign-up: the only apps that can connect are the ones in the `MCP_CLIENTS` secret. Each has a fixed client id, a secret and exact redirect URIs. There's no registration endpoint. `/authorize` and `/token` refuse any other client, and `/token` also needs the client's secret. `/mcp` re-checks the token's client against the list on every call. `/mcp` is a stateless MCP endpoint that serves the tools.
- **This Worker ↔ Etsy:** `/authorize` goes straight to Etsy's OAuth (PKCE). There's no consent page, because every client is one she listed. The `state` is single-use, held in the `OneTimeStore` Durable Object and bound to the browser by a cookie. Only the Etsy user and shop in `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID` get a grant. Anyone else gets a 403, and nothing is stored.
- **Etsy tokens** live only in the `EtsyTokenVault` Durable Object, sealed with AES-256-GCM (`TOKEN_ENC_KEYS`, shop id as AAD). The vault refreshes them, one refresh at a time. If Etsy refuses the refresh token, the vault clears itself and her MCP grants are revoked, so the client asks her to reconnect.
- **Tools** (`src/tools/`, registered in `src/mcp/`) each call Etsy through the typed client and pass its answers through allowlist schemas, so buyer email and street address never reach the chat (`get_order` shows the address only when asked). Every tool declares `readOnlyHint` and `destructiveHint`.
- **Confirmation:** the tools that cost money or can't be undone (publish, renew, deactivate, delete, remove a photo, mark shipped) answer their first call with a preview and a single-use token, stored in the `OneTimeStore` for 10 minutes with a hash of the arguments. Only a second call with that token and identical arguments makes the change.
- **Photos:** `request_photo_upload` gives her a 30-minute link to `/upload` (the token rides in the URL fragment, signed with `UPLOAD_SIGNING_KEY`). The page shrinks photos to at most 3000 px and posts them one at a time; the Worker checks each (JPEG or PNG, at most 10 MB and 6000 px a side) and stages it in the `UPLOADS` R2 bucket. `attach_uploaded_photos` sends them to Etsy in her order under an exclusive lease, so a retry after a failure sends only the rest.
- **Daily cron** (06:17 UTC): refreshes the Etsy token (so the 90-day refresh token never idles out), records each active listing's lifetime views in one `views:YYYY-MM-DD` KV key, and records how it went in `cron:last-run`. `get_views_trend` works from these snapshots, because Etsy only reports lifetime totals.

## Development

Requires Node 24 (`.nvmrc`).

```sh
npm ci
npm run dev          # local Worker via wrangler
npm test             # workerd + Node test projects, with coverage
```

Every PR must pass the `ci-pass` check (typecheck, lint, format, knip, tests with coverage, build, generated-types freshness, secret scan). See `AGENTS.md` for the rules.

## Setting up the server

You need the Cloudflare account, the Etsy app and Node 24.

1. **Etsy app:** at developer.etsy.com, note the app's keystring and shared secret.
2. **Secrets file:** copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill it in:
   - `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`: from the Etsy app.
   - `TOKEN_ENC_KEYS`: the output of `printf '{"k1":"%s"}' "$(openssl rand -base64 32)"`, with `TOKEN_ENC_KID=k1`.
   - `ALLOWED_ETSY_USER_ID`, `ALLOWED_ETSY_SHOP_ID`: leave them `unset` for now. Step 5 finds the real values.
   - `MCP_CLIENTS`: the apps allowed to connect (see "MCP clients" below). Make each secret with `openssl rand -base64 32`.
   - `UPLOAD_SIGNING_KEY`: the output of `openssl rand -base64 32`. It signs photo upload links.
3. **Photo bucket:** run `npx wrangler login`, then `npx wrangler r2 bucket create etsy-shop-uploads` and `npx wrangler r2 bucket lifecycle add etsy-shop-uploads --name expire-uploads --prefix uploads/ --expire-days 1`, which deletes photos that were never attached. R2 has to be enabled on the Cloudflare account first (Cloudflare asks for a payment method even though this use stays inside the free tier).
4. **First deploy, in bootstrap mode:** run `npx wrangler deploy --secrets-file .dev.vars --var ALLOWLIST_BOOTSTRAP:true`. Wrangler refuses a first deploy that lacks the required secrets, so they go up with it. It also creates the KV namespaces and Durable Objects. The Worker's address looks like `https://etsy-shop-mcp.<subdomain>.workers.dev`.
5. **Etsy callback:** set the Etsy app's callback URL to `https://<worker address>/callback`.
6. **Find her Etsy ids:** connect from Claude (see the user guide). In bootstrap mode, the callback page shows her user id and shop id. It grants nothing and stores nothing. Set them with `npx wrangler secret put ALLOWED_ETSY_USER_ID` and `npx wrangler secret put ALLOWED_ETSY_SHOP_ID`. Then run `npm run deploy`, which turns bootstrap off (`ALLOWLIST_BOOTSTRAP` is `"false"` in `wrangler.jsonc`).
7. **Connect** Claude and ChatGPT as `docs/user-guide.md` describes. Each app asks for its client id and secret from `MCP_CLIENTS`.
8. **Automatic deploys (optional):** add a `CLOUDFLARE_API_TOKEN` repository secret (an API token with the "Edit Cloudflare Workers" template), plus a `CLOUDFLARE_ACCOUNT_ID` repository variable if the token covers more than one account. `.github/workflows/deploy.yml` then deploys `main` after CI passes. Without the secret, it skips with a notice.

Local development uses `.dev.vars` (copy `.dev.vars.example`) and `npm run dev`.

### MCP clients

`MCP_CLIENTS` is a JSON list on one line in `.dev.vars`, and `npx wrangler secret put MCP_CLIENTS` in production:

```json
[
  {
    "id": "claude",
    "name": "Claude",
    "secret": "<openssl rand -base64 32>",
    "redirectUris": ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]
  },
  {
    "id": "chatgpt",
    "name": "ChatGPT",
    "secret": "<openssl rand -base64 32>",
    "redirectUris": ["https://chatgpt.com/connector_platform_oauth_redirect"]
  }
]
```

Ids are 3–40 characters of lowercase letters, digits and `-`. Secrets need at least 32 characters. Redirect URIs must be plain `https` (no `#` fragment, no user info) and match exactly what the app sends. If an app's connector settings show a different callback URL, add that URL here. If the secret is missing or malformed, every route except `/health` answers 503, so nothing is open by accident. The Worker brings its OAuth client records in line with the list on the next `/authorize` or `/token` request. Cloudflare KV can serve a cached copy for about a minute in other locations, so a changed secret can take that long to apply everywhere.

**Cost:** everything here runs on the Workers Free plan, and the photo bucket stays inside R2's free tier. Workers Free allows 50 Etsy calls per request, so the multi-page tools stop at a page cap and say when they did: `list_orders` at 300 orders, `get_sales_summary` at the newest 3,000 orders in its range, and the daily snapshot at 3,500 active listings. Each request also has a budget of 45 Etsy calls, and rate-limit retries count against it. When Etsy keeps rate limiting, a multi-page tool returns what it read so far, marked truncated, instead of failing. A bigger shop, or the logs showing CPU-limit errors, means Workers Paid ($5/month).

## Runbook

- **A device with a connected app is lost, or anything looks wrong:** run `scripts/revoke-all-grants.sh`. It needs wrangler logged in, plus jq. Every connected client is cut off and must connect again, which needs her Etsy sign-in. To cut Etsy off too, revoke the app under Etsy → Account settings → Apps (or rotate `TOKEN_ENC_KEYS` as below without keeping the old key), and change her Etsy password.
- **Rotate the upload signing key:** `npx wrangler secret put UPLOAD_SIGNING_KEY` with a new `openssl rand -base64 32`. Open upload links stop working; nothing else is affected.
- **The daily snapshot failed:** `get_shop_overview` shows the last run's error. "Etsy isn't connected" means she needs to reconnect; anything else usually clears on the next day's run.
- **Rotate the Etsy shared secret:** create a new one in the Etsy developer portal, then `npx wrangler secret put ETSY_SHARED_SECRET`.
- **Rotate the vault key:** add a new key next to the old one (`{"k1":"…","k2":"…"}`) and set `TOKEN_ENC_KID` to `k2`. The vault re-seals its record under `k2` the next time it's read. After that, remove `k1`. Dropping a key whose record hasn't been re-sealed means she reconnects once.
- **Change who is allowed:** update `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID`. Grants for the old ids stop working at once (`/mcp` re-checks them on every call).
- **Add an MCP client:** add an entry to `MCP_CLIENTS` and `npx wrangler secret put MCP_CLIENTS`. Then enter its id and secret in the app.
- **Cut one app off:** remove its entry from `MCP_CLIENTS` and put the secret again. Its tokens stop working at once (`/mcp` re-checks the client on every call), and it can't get new ones. If you remove it because its secret leaked, also run `scripts/revoke-all-grants.sh`. Otherwise, re-adding the same id later would revive its unexpired access tokens for up to an hour.
- **Rotate an app's secret:** change its `secret` in `MCP_CLIENTS`, put the secret, and update the secret in the app. Existing access tokens keep working until they expire (up to an hour). Refreshing them needs the new secret. To cut them off at once, run `scripts/revoke-all-grants.sh`.

## Branch protection

`.github/rulesets/main.json` is the `main` ruleset (PR required, `ci-pass` required, no force-push, no deletion, no bypass). Apply it with `scripts/apply-ruleset.sh`, which needs `gh` authenticated as a repo admin.

**Break-glass:** `scripts/apply-ruleset.sh --disable` turns enforcement off, and `--enable` restores it. Use it only for a broken CI provider, never to merge past a failing check.
