import { z } from "zod";

import type { EtsyClient } from "./create-etsy-client";

export interface EtsyMe {
  readonly userId: string;
  // Empty when the account has no shop.
  readonly shopId: string;
}

const ME = z.object({
  user_id: z.number().int(),
  shop_id: z.number().int().nullish(),
});

// Who just signed in to Etsy (getMe), parsed at runtime because the allowlist decision
// rests on it. Null on any failure; the caller never sees Etsy's response body.
export async function fetchEtsyMe(client: EtsyClient): Promise<EtsyMe | null> {
  try {
    const { data, response } = await client.GET("/v3/application/users/me");
    const parsed = ME.safeParse(data);
    if (!response.ok || !parsed.success) {
      return null;
    }
    const shopId = parsed.data.shop_id;
    return {
      userId: String(parsed.data.user_id),
      shopId: shopId === null || shopId === undefined ? "" : String(shopId),
    };
  } catch {
    return null;
  }
}
