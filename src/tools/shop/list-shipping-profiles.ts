import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { withAccessToken } from "../with-access-token";

const PROFILES = z
  .object({
    results: z.array(
      z.object({
        shipping_profile_id: z.number(),
        title: z.string(),
        origin_country_iso: z.string().nullish(),
        profile_type: z.string().nullish(),
        is_deleted: z.boolean().nullish(),
      }),
    ),
  })
  .transform((page) => page.results.filter((profile) => profile.is_deleted !== true));

export async function listShippingProfiles(deps: ShopToolDeps): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/shipping-profiles", {
      params: { path: { shop_id: Number(deps.shopId) } },
    });
    return response.ok ? shaped(PROFILES, data, "shipping profiles") : etsyError(response);
  });
}
