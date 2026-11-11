import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ORDER_SUMMARY } from "../../etsy/shapes/receipt";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { fetchReceipts } from "./fetch-receipts";

const MAX_PAGES = 3;

export interface ListOrdersArgs {
  readonly filter: "unshipped" | "paid" | "all";
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
}

function epoch(date: string | undefined, endOfDay: boolean): number | undefined {
  if (date === undefined) {
    return undefined;
  }
  return Math.floor(Date.parse(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`) / 1000);
}

// Her orders, newest first: unshipped (paid, not yet shipped), paid, or all, optionally
// within a date range (UTC days). No buyer email or street address: get_order has
// the address when she needs it.
export async function listOrders(deps: ShopToolDeps, args: ListOrdersArgs): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const pages = await fetchReceipts(
      deps.etsy(token),
      deps.shopId,
      {
        min_created: epoch(args.from, false),
        max_created: epoch(args.to, true),
        was_paid: args.filter === "all" ? undefined : true,
        was_shipped: args.filter === "unshipped" ? false : undefined,
        was_canceled: args.filter === "all" ? undefined : false,
      },
      { maxPages: MAX_PAGES, maxItems: args.limit },
    );
    if (!pages.ok) {
      return etsyError(pages.response);
    }
    const orders = z.array(ORDER_SUMMARY).safeParse(pages.items);
    if (!orders.success) {
      return toolText("Etsy returned orders in an unexpected shape.", true);
    }
    return toolText({
      orders: orders.data,
      ...(pages.truncated ? { truncated: `Showing the newest ${String(orders.data.length)}; there are more.` } : {}),
    });
  });
}
