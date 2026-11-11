import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

export async function getListing(deps: ShopToolDeps, args: { readonly listing_id: number }): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const read = await readListing(deps.etsy(token), deps.shopId, args.listing_id);
    if (!read.ok) {
      return read.result;
    }
    return toolText(Object.fromEntries(Object.entries(read.listing).filter(([key]) => key !== "shop_id")));
  });
}
