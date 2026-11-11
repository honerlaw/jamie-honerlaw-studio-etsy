import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { LISTING_PAGE } from "../../etsy/shapes/listing";
import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { withAccessToken } from "../with-access-token";

export interface ListListingsArgs {
  readonly state: "active" | "inactive" | "draft" | "expired" | "sold_out";
  readonly limit: number;
  readonly offset: number;
}

// One page of her listings in one state, newest first.
export async function listListings(deps: ShopToolDeps, args: ListListingsArgs): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/listings", {
      params: {
        path: { shop_id: Number(deps.shopId) },
        query: { state: args.state, limit: args.limit, offset: args.offset, sort_on: "created", sort_order: "desc" },
      },
    });
    return response.ok ? shaped(LISTING_PAGE, data, "listings") : etsyError(response);
  });
}
