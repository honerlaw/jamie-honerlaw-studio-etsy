import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { ADDRESS, ORDER_DETAIL } from "../../etsy/shapes/receipt";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";

// One order in full. The shipping address is included only when asked for, and the
// buyer's email never is.
export async function getOrder(
  deps: ShopToolDeps,
  args: { readonly receipt_id: number; readonly include_address: boolean },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/receipts/{receipt_id}", {
      params: { path: { shop_id: Number(deps.shopId), receipt_id: args.receipt_id } },
    });
    if (!response.ok) {
      return etsyError(response);
    }
    const order = ORDER_DETAIL.safeParse(data);
    const address = ADDRESS.safeParse(data);
    if (!order.success || !address.success) {
      return toolText("Etsy returned the order in an unexpected shape.", true);
    }
    return toolText(args.include_address ? { ...order.data, shipping_address: address.data } : order.data);
  });
}
