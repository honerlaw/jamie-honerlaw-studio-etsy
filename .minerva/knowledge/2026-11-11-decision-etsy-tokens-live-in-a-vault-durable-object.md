# Her Etsy tokens live encrypted in one Durable Object, not in the MCP grant

**Date**: 2026-11-11
**Type**: decision
**Theme**: auth
**Summary**: An EtsyTokenVault Durable Object holds encrypted Etsy tokens and makes exactly one refresh at a time.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
Etsy access tokens last an hour. Each refresh returns a new refresh token, which lasts 90 days and replaces the old one. One rejected option kept the tokens in the oauth-provider's grant props, via `tokenExchangeCallback`. That ties Etsy refresh to the MCP client's own refresh schedule, races when two clients rotate at once, and can't refresh in the background.

## Finding
- One `EtsyTokenVault` Durable Object per shop holds the tokens. They are sealed with AES-GCM, using a key id prefix, a fresh IV and the shop id as AAD. Keys come from the `TOKEN_ENC_KEYS` key ring, and `TOKEN_ENC_KID` names the current key.
- `getAccessToken()` is single-flight: N concurrent callers trigger one Etsy refresh. The rotated refresh token is persisted in one atomic put. A record sealed under an old key is re-sealed under the current one.
- `invalid_grant` clears the record. The tool layer then revokes her MCP grants and tells her to reconnect.
- The daily cron reads a token, so the refresh token never sits unused long enough to expire.

## Implications
- MCP grants carry only her Etsy user id and shop id. No Etsy secret ever reaches the oauth-provider's KV.
- Key rotation: add the new key to the ring and switch `TOKEN_ENC_KID`. Keep the old key until every record has been re-sealed. Losing every key means she reconnects; no data is lost beyond that.

## Related
- [[2026-11-11-pattern-durable-object-for-single-use-values-and-leases]] — the same "a Durable Object serializes it" reasoning
