import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { withAccessToken } from "../with-access-token";

const POLICIES = z
  .object({
    results: z.array(
      z.object({
        return_policy_id: z.number(),
        accepts_returns: z.boolean(),
        accepts_exchanges: z.boolean(),
        return_deadline: z.number().nullish(),
      }),
    ),
  })
  .transform((page) => page.results);

export async function listReturnPolicies(deps: ShopToolDeps): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/shops/{shop_id}/policies/return", {
      params: { path: { shop_id: Number(deps.shopId) } },
    });
    return response.ok ? shaped(POLICIES, data, "return policies") : etsyError(response);
  });
}
