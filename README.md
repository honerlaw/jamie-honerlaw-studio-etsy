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

Every PR must pass the `ci-pass` check (typecheck, lint, format, knip, tests with coverage, build, generated-types freshness, Terraform fmt and validate, secret scan). See `AGENTS.md` for the rules.

## Setting up the server

Production runs from three places, and nothing is set up by hand-typed `wrangler` commands:

- **Terraform** (`infra/`) owns the Cloudflare resources the Worker binds to: the `etsy-shop-uploads` R2 bucket and its one-day rule for `uploads/`, and the two KV namespaces. Its state lives in the `etsy-shop-mcp-tfstate` R2 bucket.
- **Doppler** (project `etsy-shop-mcp`, config `prd`) holds every secret: the eight Worker secrets in `wrangler.jsonc`'s `secrets.required`, plus the Cloudflare API token and account id the deploy uses.
- **GitHub Actions** (`.github/workflows/deploy.yml`) deploys `main` after CI passes on every merge. It holds one secret, `DOPPLER_TOKEN`: a read-only Doppler service token in the `production` environment, which only `main` can deploy to.

`.minerva/reference/deploy.md` describes how a deploy runs. To set it all up once:

1. **Prerequisites:** a Cloudflare account with R2 enabled (Cloudflare asks for a payment method even though this use stays inside the free tier) and a workers.dev subdomain (Workers & Pages in the dashboard picks one the first time). A Doppler account. Locally: Node 24, `npm ci`, the Doppler CLI (`doppler login`) and the GitHub CLI (`gh auth login` as a repo admin).
2. **Etsy app:** at developer.etsy.com, note the app's keystring and shared secret.
3. **Cloudflare API token:** create one (My Profile → API Tokens, or the account's API Tokens page) with Account: Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit and Account Settings Read, and User: Memberships Read, limited to this account. Note the account id too (on the account's home page).
4. **Run `npm run bootstrap`.** It asks for the Cloudflare token, the account id and the Etsy keystring and shared secret, without echoing the secrets, and stores them in Doppler. It generates the other secrets (`TOKEN_ENC_KEYS`, `TOKEN_ENC_KID`, `UPLOAD_SIGNING_KEY`, `MCP_CLIENTS` with a Claude and a ChatGPT client) and sets her ids to `unset`, which makes every sign-in fail closed. Then it creates the state bucket, limits the GitHub `production` environment to `main` (`.github/environments/production.json`), and stores a read-only Doppler service token there as `DOPPLER_TOKEN`. It never prints a secret, and running it again only fills what is missing.
5. **First deploy, in bootstrap mode:** `gh workflow run deploy.yml -f bootstrap=true`. Terraform creates the bucket and namespaces, and Wrangler deploys the Worker with `ALLOWLIST_BOOTSTRAP` on. The log shows the Worker's address, which looks like `https://etsy-shop-mcp.<subdomain>.workers.dev`. Don't merge anything to `main` until step 8: a merge's deploy can replace this queued run, or turn bootstrap mode off after it.
6. **Etsy callback:** set the Etsy app's callback URL to `https://<worker address>/callback`.
7. **Connect from Claude** as `docs/user-guide.md` describes. The client id is `claude`, and its secret is in `doppler secrets get MCP_CLIENTS --plain --project etsy-shop-mcp --config prd`. In bootstrap mode, the callback page shows her Etsy user id and shop id. It grants nothing and stores nothing.
8. **Set her ids and deploy normally:** `doppler secrets set ALLOWED_ETSY_USER_ID=<user id> ALLOWED_ETSY_SHOP_ID=<shop id> --project etsy-shop-mcp --config prd`, then `gh workflow run deploy.yml`, which turns bootstrap off (`ALLOWLIST_BOOTSTRAP` is `"false"` in `wrangler.jsonc`).
9. **Connect** Claude again, and ChatGPT the same way (client id `chatgpt`, its secret from the same command).

From then on, every merge to `main` deploys once CI passes. Changing a secret in Doppler deploys nothing by itself: run `gh workflow run deploy.yml` after.

Local development uses `.dev.vars` (copy `.dev.vars.example`) and `npm run dev`.

### MCP clients

`MCP_CLIENTS` is a JSON list on one line, in `.dev.vars` locally and in Doppler for production (`npm run bootstrap` generates it):

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

**Cost:** everything here runs on the Workers Free plan, and the photo bucket stays inside R2's free tier. Workers Free allows 50 Etsy calls per request, so the multi-page tools stop at a page cap and say when they did: `list_orders` at 300 orders, `get_sales_summary` at the newest 3,000 orders in its range, and the daily snapshot at 3,500 active listings. Each request also has a budget of 45 Etsy calls, and rate-limit retries count against it. When Etsy keeps rate limiting, a multi-page tool returns what it read so far, marked truncated, instead of failing. The daily snapshot is skipped that day instead, since a partial one would look like a drop in views. A bigger shop, or the logs showing CPU-limit errors, means Workers Paid ($5/month).

## Runbook

Secrets live in Doppler (`etsy-shop-mcp/prd`). "Set" below means `doppler secrets set NAME --project etsy-shop-mcp --config prd` (it reads the value from stdin, so it stays out of your shell history), and "deploy" means `gh workflow run deploy.yml`. A Doppler change reaches the Worker only on the next deploy.

- **A device with a connected app is lost, or anything looks wrong:** run `scripts/revoke-all-grants.sh`. It needs wrangler logged in (`npx wrangler login`), plus jq. It finds the OAuth namespace by the title Terraform gives it (`etsy-shop-mcp-oauth`), through `wrangler kv namespace list`, since `wrangler.jsonc` carries no KV ids. Every connected client is cut off and must connect again, which needs her Etsy sign-in. To cut Etsy off too, revoke the app under Etsy → Account settings → Apps (or rotate `TOKEN_ENC_KEYS` as below without keeping the old key), and change her Etsy password.
- **Rotate the upload signing key:** set `UPLOAD_SIGNING_KEY` to a new `openssl rand -base64 32`, then deploy. Open upload links stop working; nothing else is affected.
- **The daily snapshot failed:** `get_shop_overview` shows the last run's error. "Etsy isn't connected" means she needs to reconnect; anything else usually clears on the next day's run.
- **Rotate the Etsy shared secret:** create a new one in the Etsy developer portal, set `ETSY_SHARED_SECRET`, then deploy.
- **Rotate the vault key:** add a new key next to the old one in `TOKEN_ENC_KEYS` (`{"k1":"…","k2":"…"}`), set `TOKEN_ENC_KID` to `k2`, and deploy. The vault re-seals its record under `k2` the next time it's read. After that, remove `k1` and deploy. Dropping a key whose record hasn't been re-sealed means she reconnects once.
- **Change who is allowed:** set `ALLOWED_ETSY_USER_ID` and `ALLOWED_ETSY_SHOP_ID`, then deploy. Grants for the old ids stop working at once (`/mcp` re-checks them on every call).
- **Add an MCP client:** add an entry to `MCP_CLIENTS`, set it, and deploy. Then enter its id and secret in the app.
- **Cut one app off:** remove its entry from `MCP_CLIENTS`, set it, and deploy. Its tokens stop working at once (`/mcp` re-checks the client on every call), and it can't get new ones. If you remove it because its secret leaked, also run `scripts/revoke-all-grants.sh`. Otherwise, re-adding the same id later would revive its unexpired access tokens for up to an hour.
- **Rotate an app's secret:** change its `secret` in `MCP_CLIENTS`, set it, deploy, and update the secret in the app. Existing access tokens keep working until they expire (up to an hour). Refreshing them needs the new secret. To cut them off at once, run `scripts/revoke-all-grants.sh`.
- **During first-time setup:** don't merge to `main` between the bootstrap dispatch (setup step 5) and setting her ids (step 8). A merge's deploy can replace the queued bootstrap run, or turn bootstrap mode off once it ran; if that happens, dispatch `gh workflow run deploy.yml -f bootstrap=true` again.
- **Rotate `DOPPLER_TOKEN`:** revoke the old service token in Doppler (project `etsy-shop-mcp` → `prd` → Access), then run `npm run bootstrap -- --rotate-doppler-token`.
- **Rotate the Cloudflare API token:** create the new token (setup step 3), set `CLOUDFLARE_API_TOKEN`, deploy, then delete the old token. The Terraform state credentials come from the token, so nothing else changes.
- **A deploy failed with "the Terraform plan deletes or replaces":** a merged change removed or renamed a resource in `infra/`. Every later deploy fails the same way until a fix is merged. To rename, add a `moved {}` block; to stop managing a resource, a `removed {}` block. Only if the deletion is really meant, run `gh workflow run deploy.yml -f allow_destroy=true` (the bucket and both namespaces also carry `prevent_destroy`, so deleting one needs that removed in a PR first).
- **A deploy failed and you want to retry it:** use `gh workflow run deploy.yml`, not "Re-run failed jobs" on an older run. A re-run reuses that run's old commit: its deploy job stops itself if the commit is no longer the tip of `main`, but it can first displace a waiting deploy of the tip (it warns when that may have happened).
- **A Terraform error in the deploy after a merge:** `terraform validate` in CI can't see Cloudflare API errors (a taken name, a missing permission), so they first show up in the Deploy run. Fix it in a PR; the merge deploys again.
- **Terraform state is lost or wrong:** the state bucket keeps no old versions. Never run `terraform import` locally. Commit `import {}` blocks for the existing resources (KV titles are unique per account, so a deploy with missing state fails on create instead of making empty namespaces) and let the Deploy workflow apply them.
- **A secret was removed from `secrets.required`:** Wrangler adds and updates secrets but never deletes one, so the old secret stays on the Worker until `npx wrangler secret delete <NAME> --name etsy-shop-mcp`.
- **GitHub Actions is down:** deploys wait. There is no local deploy path, so Terraform state has only one writer.

## Branch protection

`.github/rulesets/main.json` is the `main` ruleset (PR required, `ci-pass` required, no force-push, no deletion, no bypass). Apply it with `scripts/apply-ruleset.sh`, which needs `gh` authenticated as a repo admin.

**Break-glass:** `scripts/apply-ruleset.sh --disable` turns enforcement off, and `--enable` restores it. Use it only for a broken CI provider, never to merge past a failing check.
