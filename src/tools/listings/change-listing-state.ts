import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { LISTING_SUMMARY } from "../../etsy/shapes/listing";
import { runGated } from "../confirm/run-gated";
import { etsyError } from "../etsy-error";
import { shaped } from "../shaped";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

export interface StateChange {
  readonly tool: string;
  // The states this change applies to, and the state it sets.
  readonly from: readonly string[];
  readonly to: "active" | "inactive";
  readonly what: string;
  readonly fee: string | null;
  // A physical listing can't go live without at least one photo.
  readonly needsPhoto: boolean;
}

// The shared body of publish_listing, renew_listing and deactivate_listing: a confirmed
// state change. The preview is one Etsy read (the listing); the write one PATCH.
export async function changeListingState(
  deps: ShopToolDeps,
  args: { readonly listing_id: number; readonly confirmation_token?: string | undefined },
  change: StateChange,
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    return runGated({
      store: deps.store,
      tool: change.tool,
      args,
      preview: async () => {
        const read = await readListing(etsy, deps.shopId, args.listing_id);
        if (!read.ok) {
          return read.result;
        }
        const { listing } = read;
        if (!change.from.includes(listing.state)) {
          return toolText(
            `The listing is ${listing.state}, so it can't be ${change.what}. That works for: ${change.from.join(", ")}.`,
            true,
          );
        }
        if (change.needsPhoto && (listing.images ?? []).length === 0) {
          return toolText("The listing has no photos yet. Add some with request_photo_upload first.", true);
        }
        return {
          action: `${change.what}: "${listing.title}" (${listing.state} → ${change.to})`,
          listing_id: listing.listing_id,
          price: listing.price,
          quantity: listing.quantity,
          photos: (listing.images ?? []).length,
          ...(change.fee === null ? {} : { fee: change.fee }),
          ...(listing.state === "sold_out" && change.to === "active"
            ? { note: "Etsy sets a sold-out listing's quantity to 1 when it's renewed." }
            : {}),
        };
      },
      write: async () => {
        const { data, response } = await etsy.PATCH("/v3/application/shops/{shop_id}/listings/{listing_id}", {
          params: { path: { shop_id: Number(deps.shopId), listing_id: args.listing_id } },
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: { state: change.to },
        });
        return response.ok ? shaped(LISTING_SUMMARY, data, "the updated listing") : etsyError(response);
      },
    });
  });
}
