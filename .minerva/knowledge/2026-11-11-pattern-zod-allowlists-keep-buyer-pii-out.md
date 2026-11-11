# Etsy responses pass through zod allowlist shapes before they reach the chat

**Date**: 2026-11-11
**Type**: pattern
**Theme**: shop-tools
**Summary**: Every tool output is a zod allowlist; buyer email never leaves, address only on request.
**Context**: .minerva/work/2026-11-10-etsy-shop-mcp-server (see git history if the worktree has been cleaned up)

## Context
Etsy receipts carry buyer PII: email, street address, payment email, and refund notes. Tool output goes into a chat transcript held by a third-party assistant.

## Finding
- Each tool parses Etsy's response through a zod object that names only the fields to show (`src/etsy/shapes/`). zod drops every key it doesn't name, so a new Etsy field is hidden until it is added on purpose.
- `ORDER_SUMMARY` and `ORDER_DETAIL` never name `buyer_email` or `payment_email`. Only the separate `ADDRESS` shape carries the street address, and only `get_order` with `include_address: true` uses it.
- The sales summary reads refund amounts only. Refund reasons and notes stay on the server.
- Money is turned from `{amount, divisor}` into a decimal `{amount, currency_code}` in the shape itself.
- The logger has its own field allowlist, and tests assert it drops buyer fields.

## Implications
- Showing a new Etsy field is a deliberate edit to a shape. The PII tests in `test/orders-insights.test.ts` guard the receipt shapes.
- Never return a raw Etsy response body, including inside error messages. `etsyError` maps status codes to fixed text.

## Related
- [[2026-11-11-decision-gated-writes-use-preview-bound-tokens]] — the other guard on what tools may do
