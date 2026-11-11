# MCP clients come from a closed list, with no registration and no consent page

**Date**: 2026-11-11
**Type**: decision
**Theme**: auth
**Summary**: Only confidential clients listed in the MCP_CLIENTS secret can connect; open registration is disabled.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
The server is for one seller's shop, reached from Claude and ChatGPT. The first design used dynamic client registration (DCR) limited to Claude's and ChatGPT's redirect URIs. Review showed that this restriction doesn't help: those callbacks are shared by every Claude and ChatGPT user. Anyone could register a client with them, send the seller a link, and receive a grant once she signed in with Etsy. Unauthenticated `/register` could also exhaust the Workers Free KV write quota. The owner's call was "we should have a [list] of some sort that we control who can login entirely" and "this is not a public app... there doesn't need to be signup / consent".

## Finding
- `MCP_CLIENTS` (a secret, JSON) is the complete list of confidential clients: id, secret, name and redirect URIs. There is no `registration_endpoint`, `/register` returns 404, and there is no consent page.
- Each listed client is provisioned into the oauth-provider's store with a compare-and-put of the stored record (secret hash, name, redirect URIs), so a lost or stale record repairs itself on the next request.
- A gate in front of the library refuses any request that claims a client id not in the list (the HTTP Basic id and every form `client_id`). It parses Basic exactly as the library does. Removing an id makes that client's existing tokens fail at `/mcp`.
- A missing or malformed `MCP_CLIENTS` fails closed (503 `config_invalid`) and never echoes the secret.

## Implications
- The owner adds a client by creating an id and secret, putting them in `MCP_CLIENTS`, and entering them in that app's custom-connector form. Nothing self-registers.
- A rotated secret takes up to about 60 s to propagate through KV. After removing a leaked client, run `scripts/revoke-all-grants.sh`, because re-adding the same id would otherwise revive its unexpired tokens.
- The Etsy allowlist (her user and shop id) still decides who can sign in. The client list decides which apps can ask.

## Related
- [[2026-11-11-bug-client-gate-must-parse-credentials-like-the-library]] — the gate's parser had to match the library's exactly
- [[2026-11-11-decision-etsy-tokens-live-in-a-vault-durable-object]] — what a grant gives the client access to
