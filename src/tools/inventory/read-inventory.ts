import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { EtsyClient } from "../../etsy/create-etsy-client";
import { INVENTORY, type Inventory } from "../../etsy/shapes/inventory";
import { etsyError } from "../etsy-error";
import { toolText } from "../tool-text";

// One Etsy read: a listing's whole inventory (products, their variation values and
// offerings with price and quantity).
export async function readInventory(
  etsy: EtsyClient,
  listingId: number,
): Promise<
  { readonly ok: true; readonly inventory: Inventory } | { readonly ok: false; readonly result: CallToolResult }
> {
  const { data, response } = await etsy.GET("/v3/application/listings/{listing_id}/inventory", {
    params: { path: { listing_id: listingId } },
  });
  if (!response.ok) {
    return { ok: false, result: etsyError(response) };
  }
  const inventory = INVENTORY.safeParse(data);
  return inventory.success
    ? { ok: true, inventory: inventory.data }
    : { ok: false, result: toolText("Etsy returned the inventory in an unexpected shape.", true) };
}
