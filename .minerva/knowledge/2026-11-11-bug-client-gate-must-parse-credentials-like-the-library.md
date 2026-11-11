# A gate in front of a library must parse credentials exactly as the library does

**Date**: 2026-11-11
**Type**: bug
**Theme**: auth
**Summary**: The client-list gate split Basic auth on \s while the library used [ \t], letting unlisted ids through.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
The closed client list is enforced by a gate that runs before `@cloudflare/workers-oauth-provider` handles `/token` and `/authorize`. The gate reads the client id the request claims and refuses any id that isn't listed.

## Finding
- **Root cause:** the gate split the `Authorization: Basic` header on `\s`, but the library splits on `[ \t]`. A header like `Basic<U+00A0>…`, together with a form-body `client_id`, made the gate read one id and the library authenticate another. A removed client that was still stored could reach `/token`. Its tokens still failed at `/mcp`, which re-checks the list, so the damage was limited.
- **Fix:** the gate now mirrors the library's parser:
  - it splits at `header.search(/[ \t]/)`;
  - the scheme must be `basic`, case-insensitive;
  - the credentials may contain no space or tab;
  - `+` becomes a space, then `decodeURIComponent` runs.
- The gate collects every claimed id (Basic plus every non-empty form `client_id`) and requires all of them to be listed.
- A related failure: redirect URIs with a fragment or user info passed zod, but the library threw on every request. zod now rejects them.

## Implications
- When a check guards a parser it doesn't own, copy the parser's exact tokenization, and test with inputs where the two could differ (Unicode whitespace, duplicate fields, encodings).
- Re-check the gate whenever `@cloudflare/workers-oauth-provider` is bumped. `test/clients.test.ts` exercises it against the pinned version.

## Related
- [[2026-11-11-decision-closed-mcp-client-list-instead-of-registration]] — the gate this bug was in
