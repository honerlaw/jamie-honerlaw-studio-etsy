import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { TIMESTAMP } from "../../etsy/shapes/timestamp";
import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { withAccessToken } from "../with-access-token";

// Ratings and review text, without the buyer's user id.
const REVIEWS = z.object({
  count: z.number(),
  results: z.array(
    z.object({
      listing_id: z.number(),
      rating: z.number(),
      review: z.string().nullish(),
      created_timestamp: TIMESTAMP,
    }),
  ),
});

export async function listReviews(
  deps: ShopToolDeps,
  args: { readonly limit: number; readonly offset: number },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/reviews", {
      params: { path: { shop_id: Number(deps.shopId) }, query: { limit: args.limit, offset: args.offset } },
    });
    return response.ok ? shaped(REVIEWS, data, "reviews") : etsyError(response);
  });
}
