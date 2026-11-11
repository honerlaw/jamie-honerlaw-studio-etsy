# Etsy shop MCP server

A remote [MCP](https://modelcontextprotocol.io) server that lets one Etsy seller manage her shop by chatting in Claude, ChatGPT or another MCP client. It runs on Cloudflare Workers.

**Status:** Phase 2 of 3. The OAuth 2.1 server for MCP clients, Etsy sign-in with an allowlist, the encrypted token vault, the typed Etsy client and one tool (`get_shop_overview`) are in place. The rest of the shop tools arrive in Phase 3. The design is in `.minerva/work/2026-11-10-etsy-shop-mcp-server/proposal.md`, and the seller's guide is `docs/user-guide.md`.

## How it fits together

- **MCP clients (Claude, ChatGPT) ↔ this Worker:** `@cloudflare/workers-oauth-provider` is the authorization server (PKCE S256, discovery documents, dynamic client registration, token checks). Registration accepts only ChatGPT's and Claude's documented redirect URIs, plus any listed in the `ALLOWED_REDIRECT_URIS` var. `/mcp` is a stateless MCP endpoint that serves the tools.
- **This Worker ↔ Etsy:** the consent page hands off to Etsy's OAuth (PKCE). The `state` is single-use, held in the `OneTimeStore` Durable Object and bound to the browser by a cookie. Only the Etsy user and shop in `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID` get a grant. Anyone else gets a 403, and nothing is stored.
- **Etsy tokens** live only in the `EtsyTokenVault` Durable Object, sealed with AES-256-GCM (`TOKEN_ENC_KEYS`, shop id as AAD). The vault refreshes them, one refresh at a time. If Etsy refuses the refresh token, the vault clears itself and her MCP grants are revoked, so the client asks her to reconnect.

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

1. **Deploy once** to get the Worker's address. Run `npx wrangler login`, then `npm run deploy`. Wrangler creates the KV namespaces and Durable Objects on first deploy. The address looks like `https://etsy-shop-mcp.<subdomain>.workers.dev`.
2. **Etsy app:** at developer.etsy.com, set the app's callback URL to `https://<worker address>/callback`. Note the keystring and shared secret.
3. **Secrets** (`npx wrangler secret put <NAME>` for each):
   - `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`: from the Etsy app.
   - `TOKEN_ENC_KEYS`: `printf '{"k1":"%s"}' "$(openssl rand -base64 32)"`. Set `TOKEN_ENC_KID` to `k1`.
   - `ALLOWED_ETSY_USER_ID`, `ALLOWED_ETSY_SHOP_ID`: found in the next step. Set them to `unset` for now.
4. **Find her Etsy ids (bootstrap):** run `npx wrangler deploy --var ALLOWLIST_BOOTSTRAP:true`. Connect from Claude (see the user guide), and the callback page shows her user id and shop id. It grants nothing and stores nothing. Put the two ids into the secrets, then run `npm run deploy` again, which turns bootstrap off.
5. **Connect** Claude and ChatGPT as `docs/user-guide.md` describes.
6. **Automatic deploys (optional):** add a `CLOUDFLARE_API_TOKEN` repository secret (an API token with the "Edit Cloudflare Workers" template), plus a `CLOUDFLARE_ACCOUNT_ID` repository variable if the token covers more than one account. `.github/workflows/deploy.yml` then deploys `main` after CI passes. Without the secret, it skips with a notice.

Local development uses `.dev.vars` (copy `.dev.vars.example`) and `npm run dev`.

**Cost:** everything here runs on the Workers Free plan. If the logs ever show CPU-limit errors, Workers Paid ($5/month) is the fix.

## Runbook

- **A device with a connected app is lost, or anything looks wrong:** run `scripts/revoke-all-grants.sh`. It needs wrangler logged in, plus jq. Every connected client is cut off and must connect again, which needs her Etsy sign-in. To cut Etsy off too, revoke the app under Etsy → Account settings → Apps (or rotate `TOKEN_ENC_KEYS` as below without keeping the old key), and change her Etsy password.
- **Rotate the Etsy shared secret:** create a new one in the Etsy developer portal, then `npx wrangler secret put ETSY_SHARED_SECRET`.
- **Rotate the vault key:** add a new key next to the old one (`{"k1":"…","k2":"…"}`) and set `TOKEN_ENC_KID` to `k2`. The vault re-seals its record under `k2` the next time it's read. After that, remove `k1`. Dropping a key whose record hasn't been re-sealed means she reconnects once.
- **Change who is allowed:** update `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID`. Grants for the old ids stop working at once (`/mcp` re-checks them on every call).
- **Add an MCP client:** add its exact OAuth redirect URI to the `ALLOWED_REDIRECT_URIS` var in `wrangler.jsonc` (comma-separated) and deploy.

## Branch protection

`.github/rulesets/main.json` is the `main` ruleset (PR required, `ci-pass` required, no force-push, no deletion, no bypass). Apply it with `scripts/apply-ruleset.sh`, which needs `gh` authenticated as a repo admin.

**Break-glass:** `scripts/apply-ruleset.sh --disable` turns enforcement off, and `--enable` restores it. Use it only for a broken CI provider, never to merge past a failing check.
