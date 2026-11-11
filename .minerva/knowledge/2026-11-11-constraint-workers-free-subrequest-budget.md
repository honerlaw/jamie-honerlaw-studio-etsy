# Workers Free allows 50 subrequests per invocation, so Etsy calls share a budget

**Date**: 2026-11-11
**Type**: constraint
**Theme**: workers-platform
**Summary**: Multi-page tools cap pages and share a 45-call Etsy budget; hitting it returns truncated data.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
The server runs on the Workers Free plan, which allows 50 outbound subrequests per invocation. Etsy paginates at 100 items per page. Every 429 retry (up to 2 per request, honouring `Retry-After`) is another subrequest.

## Finding
- **Page caps:** each multi-page tool has one, and says so when the cap cuts it short: `list_orders` stops at 3 pages (300 orders), `get_sales_summary` at 30 pages, and the daily views snapshot at 35 pages (3,500 active listings).
- **Shared budget:** every Etsy client in one invocation (one MCP request, or one cron run) draws on a single 45-request budget (`etsySubrequestBudget`). That leaves room for the token refresh and a photo download. Once the budget is spent, the client answers 429 without sending anything.
- **A 429 mid-read:** `fetchPages` treats a 429 after the first page (from Etsy, or from the spent budget) as the end of the data. It returns the pages already read, marked `truncated` and `rateLimited`, rather than failing. A 429 on the first page is still an error. Tools say how many items the partial result covers.
- **The cron skips a rate-limited snapshot.** Rate limiting stops the read at an arbitrary point, and saving that subset would make the next day's trend show a drop in views. The page cap stops at the same place every day, so a capped snapshot is still saved.
- Without the budget, a rate-limited large shop made the cron throw on the platform limit and lose that day's snapshot.

## Implications
- Shops above about 3,000 active listings, or long sales ranges, need Workers Paid (/month). The README says so.
- New tools that page must pass a page cap, and must report truncation, never truncate silently.
- Calls to bindings (KV, R2, Durable Objects) are not counted in this budget. Cloudflare counts calls to its own services against a separate, higher limit. That is unverified here: a 10-photo attach makes about 20 R2 and 12 DO calls, so if the live run hits a subrequest error there, this is where to look.

## Related
- [[2026-11-11-constraint-workers-test-pool-quirks]] — other platform facts learned building this
