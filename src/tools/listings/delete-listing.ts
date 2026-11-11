import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { runGated } from "../confirm/run-gated";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

// Deletes a listing for good, after a confirmed preview (one read).
export async function deleteListing(
  deps: ShopToolDeps,
  args: { readonly listing_id: number; readonly confirmation_token?: string | undefined },
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    return runGated({
      store: deps.store,
      tool: "delete_listing",
      args,
      preview: async () => {
        const read = await readListing(etsy, deps.shopId, args.listing_id);
        return read.ok
          ? {
              action: `Delete "${read.listing.title}" permanently (it is ${read.listing.state}). This can't be undone.`,
              listing_id: read.listing.listing_id,
            }
          : read.result;
      },
      write: async () => {
        const { response } = await etsy.DELETE("/v3/application/listings/{listing_id}", {
          params: { path: { listing_id: args.listing_id } },
        });
        return response.ok ? toolText({ deleted: args.listing_id }) : etsyError(response);
      },
    });
  });
}
