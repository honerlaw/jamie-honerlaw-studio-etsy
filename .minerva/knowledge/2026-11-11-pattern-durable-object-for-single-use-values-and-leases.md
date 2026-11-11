# Single-use values and leases live in a Durable Object, and a lease has an id

**Date**: 2026-11-11
**Type**: pattern
**Theme**: workers-platform
**Summary**: OneTimeStore DO gives atomic consume and leases; only the lease-id holder may update or finish.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
OAuth `state`, confirmation tokens and photo upload sessions must each be used exactly once. Workers KV is eventually consistent and has no compare-and-swap, so a value read twice in quick succession can be consumed twice.

## Finding
- `OneTimeStore` is a SQLite-backed Durable Object. It runs one event at a time and its synchronous `ctx.storage.kv` calls never yield, so each method reads and writes in one uninterruptible step. It offers `put` (with TTL), `consume`, `peek`, `claim(key, leaseMs)`, `update`, `finish` and `release`, plus an alarm that sweeps expired entries.
- **Leases carry an id.** `claim` returns `{value, lease}`. `update`, `finish` and `release` act only when the entry's lease id is still that one, and a `put` drops the lease.
- The bug this prevents (caught in review): with an anonymous lease, a new upload link issued during a running photo attach was overwritten by the stale attach's `update` and then deleted by its `consume`. Every upload on the new link answered 410.
- A lease that runs out frees itself, so a crashed holder can't lock an entry forever. Its stale id still can't write after someone else claims.

## Implications
- Anything that must be used once, or worked on by one caller at a time, goes in `OneTimeStore`, never KV.
- A long-running holder must treat `update(...) === false` as "someone replaced this" and stop, not continue writing.

## Related
- [[2026-11-11-decision-gated-writes-use-preview-bound-tokens]] — confirmation tokens are consumed here
- [[2026-11-11-constraint-chat-apps-cant-hand-photos-to-mcp-tools]] — upload sessions are leased here
