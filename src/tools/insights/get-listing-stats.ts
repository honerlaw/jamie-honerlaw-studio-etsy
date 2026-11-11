import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { readListing } from "../listings/read-listing";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { METRICS_NOTE } from "./metrics-note";

// Lifetime views and favorites for one listing.
export async function getListingStats(
  deps: ShopToolDeps,
  args: { readonly listing_id: number },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const read = await readListing(deps.etsy(token), deps.shopId, args.listing_id);
    if (!read.ok) {
      return read.result;
    }
    const { listing } = read;
    return toolText({
      listing_id: listing.listing_id,
      title: listing.title,
      state: listing.state,
      lifetime_views: listing.views ?? 0,
      favorites: listing.num_favorers ?? 0,
      note: `${METRICS_NOTE} For views over time, use get_views_trend.`,
    });
  });
}
