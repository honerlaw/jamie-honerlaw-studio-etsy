import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { INVENTORY } from "../../etsy/shapes/inventory";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { describeInventory } from "./describe-inventory";
import { readInventory } from "./read-inventory";
import { writableInventory, type InventoryChange } from "./writable-inventory";

// Changes prices, quantities, SKUs or availability without touching anything else: it
// reads the inventory, applies the changes, and writes the whole inventory back.
export async function updateListingInventory(
  deps: ShopToolDeps,
  args: { readonly listing_id: number; readonly changes: readonly InventoryChange[] },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    const read = await readInventory(etsy, args.listing_id);
    if (!read.ok) {
      return read.result;
    }
    const known = new Set(read.inventory.products.map((product) => product.product_id));
    const unknown = args.changes.filter((change) => !known.has(change.product_id));
    if (unknown.length > 0) {
      return toolText(
        `No product ${unknown.map((change) => String(change.product_id)).join(", ")} on this listing. Nothing was changed.`,
        true,
      );
    }
    const { data, response } = await etsy.PUT("/v3/application/listings/{listing_id}/inventory", {
      params: { path: { listing_id: args.listing_id } },
      body: writableInventory(read.inventory, args.changes),
    });
    if (!response.ok) {
      return etsyError(response);
    }
    const updated = INVENTORY.safeParse(data);
    return toolText({ updated: true, products: updated.success ? describeInventory(updated.data) : null });
  });
}
