import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { withAccessToken } from "../with-access-token";

const SECTIONS = z
  .object({
    results: z.array(
      z.object({ shop_section_id: z.number(), title: z.string(), rank: z.number(), active_listing_count: z.number() }),
    ),
  })
  .transform((page) => page.results);

export async function listShopSections(deps: ShopToolDeps): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/sections", {
      params: { path: { shop_id: Number(deps.shopId) } },
    });
    return response.ok ? shaped(SECTIONS, data, "shop sections") : etsyError(response);
  });
}
