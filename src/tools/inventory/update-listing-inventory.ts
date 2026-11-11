import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { INVENTORY, type Inventory } from "../../etsy/shapes/inventory";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { describeInventory } from "./describe-inventory";
import { readInventory } from "./read-inventory";
import { writableInventory, type InventoryChange } from "./writable-inventory";

// Why a change names nothing on this listing (an unknown product, or an offering that
// isn't one of that product's live offerings), or null when every change matches.
function unmatched(inventory: Inventory, changes: readonly InventoryChange[]): string | null {
  const products = new Map(
    inventory.products
      .filter((product) => product.is_deleted !== true)
      .map((product) => [
        product.product_id,
        new Set(product.offerings.filter((o) => o.is_deleted !== true).map((o) => o.offering_id)),
      ]),
  );
  for (const change of changes) {
    const offerings = products.get(change.product_id);
    if (offerings === undefined) {
      return `No product ${String(change.product_id)} on this listing.`;
    }
    if (change.offering_id !== undefined && !offerings.has(change.offering_id)) {
      return `Product ${String(change.product_id)} has no offering ${String(change.offering_id)}.`;
    }
  }
  return null;
}

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
    const problem = unmatched(read.inventory, args.changes);
    if (problem !== null) {
      return toolText(`${problem} Nothing was changed.`, true);
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
