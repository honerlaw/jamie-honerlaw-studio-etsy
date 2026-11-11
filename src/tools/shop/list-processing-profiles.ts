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
        readiness_state_id: z.number(),
        readiness_state: z.string(),
        min_processing_days: z.number().nullish(),
        max_processing_days: z.number().nullish(),
        processing_days_display_label: z.string().nullish(),
      }),
    ),
  })
  .transform((page) => page.results);

// Etsy's processing profiles ("readiness state definitions"): how long an item takes
// to make or get ready. A physical listing needs one (`readiness_state_id`).
export async function listProcessingProfiles(deps: ShopToolDeps): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps
      .etsy(token)
      .GET("/v3/application/shops/{shop_id}/readiness-state-definitions", {
        params: { path: { shop_id: Number(deps.shopId) }, query: { limit: 100 } },
      });
    return response.ok ? shaped(PROFILES, data, "processing profiles") : etsyError(response);
  });
}
