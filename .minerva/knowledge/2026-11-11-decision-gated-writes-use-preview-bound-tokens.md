# Costly or destructive tools need a preview, then a token bound to identical arguments

**Date**: 2026-11-11
**Type**: decision
**Theme**: shop-tools
**Summary**: Gated tools return a preview plus a one-use token; only identical arguments plus that token write.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
The owner chose to confirm only actions that cost money or can't be undone: publishing and renewing (Etsy's listing fee), deactivating, deleting, removing a photo, and marking an order shipped (Etsy emails the buyer). A `confirm: true` argument would be pointless, because the model could simply send it.

## Finding
- **First call:** the tool returns a preview of the change and any fee. Building it takes at most 2 Etsy reads and no writes. It also returns a 128-bit `confirmation_token`, stored in `OneTimeStore` as `{tool, argsHash}` with a 10-minute TTL.
- **What the hash covers:** `argsHash` is SHA-256 over JCS (RFC 8785) canonical JSON of the zod-parsed arguments, with defaults applied and the token removed. Key order or an omitted default doesn't change it.
- **Second call:** it must carry the token and identical arguments. The token is consumed atomically and the tool name is checked, so a token can't be replayed or used by another tool.
- The tool description tells the model to show her the preview and ask first. The server can't force that, but it guarantees a preview existed and that the write is exactly what was previewed.
- Related hardening from review: `update_listing` can only turn auto-renew **off**, because turning it on commits her to a fee on every renewal. The renew preview says when a sold-out listing's quantity will become 1.

## Implications
- A new tool that costs money or can't be undone goes through `runGated` and is added to the gated-tool tests (0 writes on preview, exactly one write on confirm).
- An ungated write field that indirectly commits her to a cost belongs behind the gate, or is left out.

## Related
- [[2026-11-11-pattern-durable-object-for-single-use-values-and-leases]] — where the tokens live
