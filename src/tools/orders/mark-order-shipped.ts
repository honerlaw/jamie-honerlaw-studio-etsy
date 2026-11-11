import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { ORDER_SUMMARY } from "../../etsy/shapes/receipt";
import { runGated } from "../confirm/run-gated";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";

export interface MarkShippedArgs {
  readonly receipt_id: number;
  readonly tracking_code: string;
  readonly carrier_name: string;
  readonly note_to_buyer?: string | undefined;
  readonly confirmation_token?: string | undefined;
}

// Adds tracking and marks the order shipped. Etsy emails the buyer and it can't be
// undone, so it is confirmed first (preview: one read of the order).
export async function markOrderShipped(deps: ShopToolDeps, args: MarkShippedArgs): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    const path = { shop_id: Number(deps.shopId), receipt_id: args.receipt_id };
    return runGated({
      store: deps.store,
      tool: "mark_order_shipped",
      args,
      preview: async () => {
        const { data, response } = await etsy.GET("/v3/application/shops/{shop_id}/receipts/{receipt_id}", {
          params: { path },
        });
        if (!response.ok) {
          return etsyError(response);
        }
        const order = ORDER_SUMMARY.safeParse(data);
        if (!order.success) {
          return toolText("Etsy returned the order in an unexpected shape.", true);
        }
        return {
          action: `Mark order ${String(order.data.receipt_id)} shipped via ${args.carrier_name}, tracking ${args.tracking_code}. Etsy emails the buyer; this can't be undone.`,
          items: order.data.transactions.map((item) => `${String(item.quantity)} × ${item.title ?? "item"}`),
          ...(order.data.is_shipped ? { warning: "This order is already marked shipped." } : {}),
          ...(args.note_to_buyer === undefined ? {} : { note_to_buyer: args.note_to_buyer }),
        };
      },
      write: async () => {
        const { response } = await etsy.POST("/v3/application/shops/{shop_id}/receipts/{receipt_id}/tracking", {
          params: { path },
          body: {
            tracking_code: args.tracking_code,
            carrier_name: args.carrier_name,
            ...(args.note_to_buyer === undefined ? {} : { note_to_buyer: args.note_to_buyer }),
          },
        });
        return response.ok
          ? toolText({ shipped: args.receipt_id, tracking_code: args.tracking_code })
          : etsyError(response);
      },
    });
  });
}
