import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { EtsyClient } from "../../etsy/create-etsy-client";
import { LISTING_DETAIL } from "../../etsy/shapes/listing";
import { etsyError } from "../etsy-error";
import { toolText } from "../tool-text";

const OWNED = LISTING_DETAIL.extend({ shop_id: z.number() });

export type ReadListing =
  | { readonly ok: true; readonly listing: z.output<typeof OWNED> }
  | { readonly ok: false; readonly result: CallToolResult };

// One Etsy read: the listing with its photos, refused unless it belongs to her shop.
export async function readListing(etsy: EtsyClient, shopId: string, listingId: number): Promise<ReadListing> {
  const { data, response } = await etsy.GET("/v3/application/listings/{listing_id}", {
    params: { path: { listing_id: listingId }, query: { includes: ["Images"] } },
  });
  if (!response.ok) {
    return { ok: false, result: etsyError(response) };
  }
  const listing = OWNED.safeParse(data);
  if (!listing.success) {
    return { ok: false, result: toolText("Etsy returned the listing in an unexpected shape.", true) };
  }
  if (String(listing.data.shop_id) !== shopId) {
    return { ok: false, result: toolText("That listing isn't in her shop.", true) };
  }
  return { ok: true, listing: listing.data };
}
