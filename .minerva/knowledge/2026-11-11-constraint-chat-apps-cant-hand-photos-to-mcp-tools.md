# Chat apps can't reliably hand a photo to an MCP tool, so photos go through an upload link

**Date**: 2026-11-11
**Type**: constraint
**Theme**: shop-tools
**Summary**: Phone photos reach Etsy via a signed one-time upload page staged in R2, not chat attachments.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
Creating a listing from her phone needs photos. As of November 2026:
- ChatGPT's `openai/fileParams` works on the web but sends a placeholder string on iOS and Android (openai-apps-sdk-examples#185).
- Claude has no channel for an attached file to reach a custom MCP tool.
- Base64 photos passed as tool arguments get corrupted.

## Finding
- **The link:** `request_photo_upload(listing_id)` returns `https://<server>/upload#t=<token>`. The token is an HMAC under `UPLOAD_SIGNING_KEY` bound to the shop, the listing and a nonce, and it expires after 30 minutes. It travels in the URL fragment, so it is never sent to a server or put in a Referer header.
- **The page:** a strict CSP (hashed inline script and style), `X-Frame-Options: DENY` and `no-referrer`. It downscales photos to 3000 px JPEG in the browser and POSTs one photo per request, with the token in the `Authorization` header and a same-origin `Origin`.
- **The server** checks size (10 MB), magic bytes (JPEG/PNG) and dimensions (6000 px), then stages the photo in R2 at `uploads/<nonce>/<rank>`. A lifecycle rule deletes leftovers after a day.
- **Attaching:** `attach_uploaded_photos` leases the session and sends each staged photo to Etsy with an explicit `rank`. Etsy's default rank is 1, which would make each new photo the main one. Each photo is recorded as soon as Etsy has it, and recorded photos are skipped, so a retry never duplicates one. Re-uploading a position that is already on Etsy is refused.
- **Fast path:** `add_listing_image` takes a real ChatGPT-web `{download_url}` directly, with a streamed 10 MB cap. A placeholder string gets the upload link instead.

## Implications
- Claude is the guaranteed client for photos. The ChatGPT fast path is a convenience only.
- **Known gap:** the fast path fetches any public https URL. A prompt injection (in a buyer message or a review) could get the model to add an attacker's image to a listing without confirmation. Pin the host to ChatGPT's file-download hosts once a live run shows what they are. Until then, any added image can be removed with the gated `remove_listing_image`.
- If either app gains reliable file passing to MCP tools, the fast path can take over.

## Related
- [[2026-11-11-pattern-durable-object-for-single-use-values-and-leases]] — the session lease
