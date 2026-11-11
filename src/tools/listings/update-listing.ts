import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { definedFields } from "../../etsy/defined-fields";
import { LISTING_SUMMARY } from "../../etsy/shapes/listing";
import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";

export interface UpdateListingArgs {
  readonly listing_id: number;
  readonly [field: string]: unknown;
}

// Edits a listing's text and settings. Only the fields given change. Price and
// quantity live in the inventory (update_listing_inventory); state changes are the
// confirmed publish/renew/deactivate tools.
export async function updateListing(deps: ShopToolDeps, args: UpdateListingArgs): Promise<CallToolResult> {
  const { listing_id: listingId, ...fields } = args;
  const changes = definedFields(fields);
  if (Object.keys(changes).length === 0) {
    return toolText("Nothing to change: pass at least one field to update.", true);
  }
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).PATCH("/v3/application/shops/{shop_id}/listings/{listing_id}", {
      params: { path: { shop_id: Number(deps.shopId), listing_id: listingId } },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: changes,
    });
    return response.ok ? shaped(LISTING_SUMMARY, data, "the updated listing") : etsyError(response);
  });
}
