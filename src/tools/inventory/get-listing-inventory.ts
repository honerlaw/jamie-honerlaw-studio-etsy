import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { describeInventory } from "./describe-inventory";
import { readInventory } from "./read-inventory";

export async function getListingInventory(
  deps: ShopToolDeps,
  args: { readonly listing_id: number },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const read = await readInventory(deps.etsy(token), args.listing_id);
    return read.ok
      ? toolText({ listing_id: args.listing_id, products: describeInventory(read.inventory) })
      : read.result;
  });
}
