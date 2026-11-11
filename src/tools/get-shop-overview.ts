import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { describeEtsyStatus } from "../etsy/describe-etsy-status";
import type { ShopToolDeps } from "./shop-tool-deps";
import { toolText } from "./tool-text";
import { withAccessToken } from "./with-access-token";

const SHOP = z.object({
  shop_name: z.string(),
  title: z.string().nullish(),
  currency_code: z.string(),
  url: z.string(),
  listing_active_count: z.number(),
  transaction_sold_count: z.number(),
  review_count: z.number().nullish(),
  review_average: z.number().nullish(),
  is_vacation: z.boolean(),
});

// Shop basics plus connection health: when her Etsy tokens were last issued and how
// the daily cron last went (or that it hasn't run yet).
export async function getShopOverview(deps: ShopToolDeps): Promise<CallToolResult> {
  return withAccessToken(deps, async (accessToken) => {
    const { data, response } = await deps.etsy(accessToken).GET("/v3/application/shops/{shop_id}", {
      params: { path: { shop_id: Number(deps.shopId) } },
    });
    if (!response.ok) {
      return toolText(describeEtsyStatus(response.status), true);
    }
    const shop = SHOP.safeParse(data);
    if (!shop.success) {
      return toolText("Etsy returned shop details in an unexpected shape.", true);
    }
    const vault = await deps.vaultStatus();
    return toolText({
      shop: shop.data,
      connection: {
        etsy_tokens_obtained_at: vault.obtainedAt === null ? null : new Date(vault.obtainedAt).toISOString(),
        cron: (await deps.readCronStatus()) ?? "not yet run",
      },
    });
  });
}
