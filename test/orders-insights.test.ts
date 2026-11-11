import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPages } from "../src/etsy/fetch-pages";
import { logEvent } from "../src/log/log-event";
import { getListingStats } from "../src/tools/insights/get-listing-stats";
import { getSalesSummary } from "../src/tools/insights/get-sales-summary";
import { getViewsTrend } from "../src/tools/insights/get-views-trend";
import { listReviews } from "../src/tools/insights/list-reviews";
import { viewsTrend } from "../src/tools/insights/views-trend";
import { getOrder } from "../src/tools/orders/get-order";
import { listOrders } from "../src/tools/orders/list-orders";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { LISTING_ROUTE, RECEIPT_ROUTE, listing, receipt } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";
import { resultJson, resultText } from "./support/tool-result";

const RECEIPTS = "GET /v3/application/shops/2002/receipts";
const PII = /ada@example\.com|Secret Street|Apt 2|62701|Springfield/u;

let etsy: EtsyMock;

// A receipts endpoint holding `total` receipts, served in the requested pages.
function receiptsOf(total: number): () => Response {
  return () => {
    const url = new URL(etsy.requests.at(-1)?.url ?? "");
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const results = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) =>
      receipt({ receipt_id: offset + index + 1 }),
    );
    return Response.json({ count: total, results });
  };
}

beforeEach(() => {
  etsy = mockEtsy();
  etsy.routes.set(RECEIPT_ROUTE, () => Response.json(receipt()));
});

describe("buyer details stay out of the chat", () => {
  it("list_orders has no buyer email or street address", async () => {
    etsy.routes.set(RECEIPTS, receiptsOf(2));
    const text = resultText(await listOrders(toolDeps(), { filter: "unshipped", limit: 50 }));
    expect(text).not.toMatch(PII);
    expect(
      resultJson<{ orders: unknown[] }>(await listOrders(toolDeps(), { filter: "unshipped", limit: 50 })).orders[0],
    ).toMatchObject({
      receipt_id: 1,
      name: "Ada Buyer",
      country_iso: "US",
      grandtotal: { amount: 30, currency_code: "USD" },
      transactions: [{ title: "Blue mug", quantity: 2, price: { amount: 12.5 } }],
    });
  });

  it("get_order includes the address only with include_address, and never the email", async () => {
    const without = resultText(await getOrder(toolDeps(), { receipt_id: 777, include_address: false }));
    expect(without).not.toMatch(PII);
    expect(without).toContain("Gift wrap please");
    const withAddress = resultJson<{ shipping_address: Record<string, unknown> }>(
      await getOrder(toolDeps(), { receipt_id: 777, include_address: true }),
    );
    expect(withAddress.shipping_address).toStrictEqual({
      name: "Ada Buyer",
      first_line: "1 Secret Street",
      second_line: "Apt 2",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      country_iso: "US",
    });
    expect(JSON.stringify(withAddress)).not.toContain("ada@example.com");
  });

  it("the logger drops buyer fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logEvent("order_seen", { status: 200, buyer_email: "ada@example.com", first_line: "1 Secret Street", name: "Ada" });
    expect(spy).toHaveBeenCalledWith('{"event":"order_seen","status":200}');
  });

  it("get_order reports Etsy failures and odd shapes", async () => {
    etsy.routes.set(RECEIPT_ROUTE, () => new Response(null, { status: 404 }));
    expect((await getOrder(toolDeps(), { receipt_id: 777, include_address: false })).isError).toBe(true);
    etsy.routes.set(RECEIPT_ROUTE, () => Response.json({ receipt_id: 777 }));
    expect(resultText(await getOrder(toolDeps(), { receipt_id: 777, include_address: false }))).toContain(
      "unexpected shape",
    );
  });
});

describe("list_orders filters and page cap", () => {
  it.each([
    ["unshipped", { was_paid: "true", was_shipped: "false", was_canceled: "false" }],
    ["paid", { was_paid: "true", was_canceled: "false" }],
    ["all", {}],
  ] as const)("maps %s to Etsy's filters", async (filter, expected) => {
    etsy.routes.set(RECEIPTS, receiptsOf(1));
    await listOrders(toolDeps(), { filter, from: "2026-11-01", to: "2026-11-10", limit: 5 });
    const query = Object.fromEntries(new URL(etsy.requests.at(-1)?.url ?? "").searchParams);
    expect(query).toMatchObject({
      ...expected,
      min_created: String(Date.parse("2026-11-01T00:00:00Z") / 1000),
      max_created: String(Date.parse("2026-11-10T23:59:59Z") / 1000),
    });
    expect(Object.keys(query).filter((key) => key.startsWith("was_"))).toHaveLength(Object.keys(expected).length);
  });

  it("stops at 3 pages and says the list is truncated", async () => {
    etsy.routes.set(RECEIPTS, receiptsOf(1000));
    const listed = resultJson<{ orders: unknown[]; truncated?: string }>(
      await listOrders(toolDeps(), { filter: "all", limit: 300 }),
    );
    expect(listed.orders).toHaveLength(300);
    expect(listed.truncated).toContain("there are more");
    expect(etsy.reads()).toHaveLength(3);
  });

  it("stops early at the requested limit, not truncated when there are no more", async () => {
    etsy.routes.set(RECEIPTS, receiptsOf(30));
    const listed = resultJson<{ orders: unknown[]; truncated?: string }>(
      await listOrders(toolDeps(), { filter: "all", limit: 50 }),
    );
    expect(listed.orders).toHaveLength(30);
    expect(listed.truncated).toBeUndefined();
  });

  it("reports Etsy failures and odd shapes", async () => {
    etsy.routes.set(RECEIPTS, () => new Response(null, { status: 500 }));
    expect((await listOrders(toolDeps(), { filter: "all", limit: 5 })).isError).toBe(true);
    etsy.routes.set(RECEIPTS, () => Response.json({ count: 1, results: [{ receipt_id: "x" }] }));
    expect(resultText(await listOrders(toolDeps(), { filter: "all", limit: 5 }))).toContain("unexpected shape");
    etsy.routes.set(RECEIPTS, () => Response.json({ nope: true }));
    expect((await listOrders(toolDeps(), { filter: "all", limit: 5 })).isError).toBe(true);
  });
});

describe("get_sales_summary", () => {
  it("totals revenue and ranks listings by revenue, with the metrics caveat", async () => {
    etsy.routes.set(RECEIPTS, receiptsOf(3));
    const summary = resultJson<Record<string, unknown>>(
      await getSalesSummary(toolDeps(), { from: "2026-11-01", to: "2026-11-10" }),
    );
    expect(summary).toMatchObject({
      orders: 3,
      item_sales: { USD: 75 },
      shipping: { USD: 12 },
      refunded: {},
      fully_refunded_orders: 0,
      top_listings: [{ listing_id: 555, title: "Blue mug", quantity: 6, revenue: 75 }],
    });
    expect(summary["note"]).toMatch(/visits.*search terms.*conversion/u);
    expect(summary).not.toHaveProperty("truncated");
  });

  it("leaves out tax and fully refunded orders, and totals partial refunds", async () => {
    const usd = (amount: number) => ({ amount, divisor: 100, currency_code: "USD" });
    etsy.routes.set(RECEIPTS, () =>
      Response.json({
        count: 3,
        results: [
          receipt({ receipt_id: 1 }),
          receipt({
            receipt_id: 2,
            status: "partially refunded",
            refunds: [{ amount: usd(500), reason: "chipped", note_from_issuer: "sorry" }],
          }),
          receipt({ receipt_id: 3, status: "fully refunded", refunds: [{ amount: usd(3000) }] }),
        ],
      }),
    );
    const summary = resultJson<Record<string, unknown>>(
      await getSalesSummary(toolDeps(), { from: "2026-11-01", to: "2026-11-10" }),
    );
    expect(summary).toMatchObject({
      orders: 2,
      item_sales: { USD: 50 },
      shipping: { USD: 8 },
      refunded: { USD: 5 },
      fully_refunded_orders: 1,
    });
    expect(JSON.stringify(summary)).not.toMatch(/chipped|sorry/u);
  });

  it("stops at 30 pages and says so", async () => {
    etsy.routes.set(RECEIPTS, receiptsOf(5000));
    const summary = resultJson<Record<string, unknown>>(
      await getSalesSummary(toolDeps(), { from: "2026-01-01", to: "2026-11-10" }),
    );
    expect(summary["truncated"]).toContain("3,000");
    expect(etsy.reads()).toHaveLength(30);
  });

  it("refuses a backwards range and reports Etsy failures", async () => {
    expect((await getSalesSummary(toolDeps(), { from: "2026-11-10", to: "2026-11-01" })).isError).toBe(true);
    etsy.routes.set(RECEIPTS, () => new Response(null, { status: 503 }));
    expect((await getSalesSummary(toolDeps(), { from: "2026-11-01", to: "2026-11-10" })).isError).toBe(true);
    etsy.routes.set(RECEIPTS, () => Response.json({ count: 1, results: [{}] }));
    expect(resultText(await getSalesSummary(toolDeps(), { from: "2026-11-01", to: "2026-11-10" }))).toContain(
      "unexpected shape",
    );
  });

  it("counts receipts with no total or untitled items", async () => {
    etsy.routes.set(RECEIPTS, () =>
      Response.json({
        count: 1,
        results: [
          receipt({
            subtotal: null,
            total_shipping_cost: null,
            transactions: [{ transaction_id: 1, quantity: 1 }],
          }),
        ],
      }),
    );
    const summary = resultJson<Record<string, unknown>>(
      await getSalesSummary(toolDeps(), { from: "2026-11-01", to: "2026-11-01" }),
    );
    expect(summary).toMatchObject({
      orders: 1,
      item_sales: {},
      top_listings: [{ listing_id: 0, title: "(untitled)", revenue: 0 }],
    });
  });
});

describe("listing stats, reviews and the views trend", () => {
  it("shows lifetime views and favorites", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ views: null, num_favorers: null })));
    expect(resultJson(await getListingStats(toolDeps(), { listing_id: 555 }))).toMatchObject({
      lifetime_views: 0,
      favorites: 0,
    });
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
    expect(resultJson(await getListingStats(toolDeps(), { listing_id: 555 }))).toMatchObject({
      lifetime_views: 40,
      favorites: 5,
    });
    etsy.routes.set(LISTING_ROUTE, () => new Response(null, { status: 404 }));
    expect((await getListingStats(toolDeps(), { listing_id: 555 })).isError).toBe(true);
  });

  it("lists reviews without the buyer's user id", async () => {
    etsy.routes.set("GET /v3/application/shops/2002/reviews", () =>
      Response.json({
        count: 1,
        results: [{ listing_id: 555, rating: 5, review: "Love it", buyer_user_id: 31337, created_timestamp: 0 }],
      }),
    );
    const text = resultText(await listReviews(toolDeps(), { limit: 25, offset: 0 }));
    expect(text).toContain("Love it");
    expect(text).not.toContain("31337");
    etsy.routes.set("GET /v3/application/shops/2002/reviews", () => new Response(null, { status: 500 }));
    expect((await listReviews(toolDeps(), { limit: 25, offset: 0 })).isError).toBe(true);
  });

  it("computes daily new views and top listings from the snapshots", () => {
    const trend = viewsTrend([
      { day: "2026-11-08", views: { "1": 10, "2": 5 } },
      { day: "2026-11-09", views: { "1": 14, "2": 5, "3": 2 } },
      { day: "2026-11-10", views: { "1": 15, "3": 9 } },
    ]);
    expect(trend.days).toStrictEqual([
      { day: "2026-11-08", total_views: 15, new_views: null },
      { day: "2026-11-09", total_views: 21, new_views: 4 },
      { day: "2026-11-10", total_views: 24, new_views: 8 },
    ]);
    expect(trend.top_listings).toStrictEqual([{ listing_id: 1, new_views: 5 }]);
  });

  it("reads the snapshots for the last N days and needs at least two", async () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    await env.SHOP_KV.put("views:2026-11-10", '{"1":12}');
    expect(resultJson(await getViewsTrend(toolDeps(), { days: 7 }, now))).toMatchObject({ snapshots: 1 });
    await env.SHOP_KV.put("views:2026-11-08", '{"1":10}');
    await env.SHOP_KV.put("views:2026-11-09", "not json at all");
    await env.SHOP_KV.put("views:2026-11-01", '{"1":1}');
    const trend = resultJson<{ days: { day: string }[]; note: string }>(
      await getViewsTrend(toolDeps(), { days: 7 }, now),
    );
    expect(trend.days.map((day) => day.day)).toStrictEqual(["2026-11-08", "2026-11-10"]);
    expect(trend.note).toContain("conversion");
  });
});

describe("fetchPages", () => {
  it("returns the first failed page", async () => {
    const failed = await fetchPages(
      () => Promise.resolve({ ok: false as const, response: new Response(null, { status: 500 }) }),
      {
        pageSize: 10,
        maxPages: 2,
      },
    );
    expect(failed.ok).toBe(false);
  });
});
