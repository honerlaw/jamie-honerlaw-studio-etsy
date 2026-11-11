import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ORDER_SUMMARY } from "../../etsy/shapes/receipt";
import { etsyError } from "../etsy-error";
import { fetchReceipts } from "../orders/fetch-receipts";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { METRICS_NOTE } from "./metrics-note";

// 30 pages of 100 receipts: well under Workers Free's 50 subrequests per call.
const MAX_PAGES = 30;
const TOP = 10;

interface Tally {
  title: string;
  quantity: number;
  revenue: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Revenue, order count and top listings between two UTC dates, from paid, uncanceled
// receipts. Revenue is each receipt's grand total, per currency.
export async function getSalesSummary(
  deps: ShopToolDeps,
  args: { readonly from: string; readonly to: string },
): Promise<CallToolResult> {
  const from = Date.parse(`${args.from}T00:00:00Z`);
  const to = Date.parse(`${args.to}T23:59:59Z`);
  if (!(to >= from)) {
    return toolText("`to` must be the same day as `from` or later.", true);
  }
  return withAccessToken(deps, async (token) => {
    const pages = await fetchReceipts(
      deps.etsy(token),
      deps.shopId,
      { min_created: from / 1000, max_created: Math.floor(to / 1000), was_paid: true, was_canceled: false },
      { maxPages: MAX_PAGES },
    );
    if (!pages.ok) {
      return etsyError(pages.response);
    }
    const orders = z.array(ORDER_SUMMARY).safeParse(pages.items);
    if (!orders.success) {
      return toolText("Etsy returned orders in an unexpected shape.", true);
    }
    const revenue = new Map<string, number>();
    const listings = new Map<number, Tally>();
    for (const order of orders.data) {
      if (order.grandtotal !== null && order.grandtotal !== undefined) {
        const { currency_code: currency, amount } = order.grandtotal;
        revenue.set(currency, (revenue.get(currency) ?? 0) + amount);
      }
      for (const item of order.transactions) {
        const id = item.listing_id ?? 0;
        const tally = listings.get(id) ?? { title: item.title ?? "(untitled)", quantity: 0, revenue: 0 };
        tally.quantity += item.quantity;
        tally.revenue += (item.price?.amount ?? 0) * item.quantity;
        listings.set(id, tally);
      }
    }
    const top = [...listings]
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, TOP)
      .map(([listingId, tally]) => ({ listing_id: listingId, ...tally, revenue: round(tally.revenue) }));
    return toolText({
      from: args.from,
      to: args.to,
      orders: orders.data.length,
      revenue: Object.fromEntries([...revenue].map(([currency, amount]) => [currency, round(amount)])),
      top_listings: top,
      ...(pages.truncated ? { truncated: "Stopped at the newest 3,000 orders; the totals miss older ones." } : {}),
      note: METRICS_NOTE,
    });
  });
}
