import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { runGated } from "../confirm/run-gated";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

export interface RemoveImageArgs {
  readonly listing_id: number;
  readonly listing_image_id: number;
  readonly confirmation_token?: string | undefined;
}

// Removes one photo from a listing, after a confirmed preview (one read).
export async function removeListingImage(deps: ShopToolDeps, args: RemoveImageArgs): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    return runGated({
      store: deps.store,
      tool: "remove_listing_image",
      args,
      preview: async () => {
        const read = await readListing(etsy, deps.shopId, args.listing_id);
        if (!read.ok) {
          return read.result;
        }
        const images = read.listing.images ?? [];
        const image = images.find((candidate) => candidate.listing_image_id === args.listing_image_id);
        if (image === undefined) {
          return toolText("That photo isn't on this listing.", true);
        }
        return {
          action: `Remove photo ${String(image.rank)} of ${String(images.length)} from "${read.listing.title}". This can't be undone.`,
          photo_url: image.url_570xN,
          ...(images.length === 1 && read.listing.state === "active"
            ? { warning: "It's the listing's only photo, and the listing is active." }
            : {}),
        };
      },
      write: async () => {
        const { response } = await etsy.DELETE(
          "/v3/application/shops/{shop_id}/listings/{listing_id}/images/{listing_image_id}",
          {
            params: {
              path: {
                shop_id: Number(deps.shopId),
                listing_id: args.listing_id,
                listing_image_id: args.listing_image_id,
              },
            },
          },
        );
        return response.ok ? toolText({ removed: args.listing_image_id }) : etsyError(response);
      },
    });
  });
}
