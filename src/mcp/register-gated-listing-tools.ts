import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { changeListingState } from "../tools/listings/change-listing-state";
import { deleteListing } from "../tools/listings/delete-listing";
import { LISTING_FEE_NOTE } from "../tools/listings/listing-fee";
import { LISTING_ID } from "../tools/listings/listing-fields";
import { removeListingImage } from "../tools/listings/remove-listing-image";
import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { addTool } from "./add-tool";

const TOKEN = z.string().optional().describe("Only on the confirmed second call: the token from the preview.");

// Listing changes that cost a fee or can't be undone. Each takes two calls: a preview
// (with a confirmation token), then the change itself after she agrees.
export function registerGatedListingTools(server: McpServer, deps: ShopToolDeps, confirm: string): void {
  const input = z.object({ listing_id: LISTING_ID, confirmation_token: TOKEN });
  const gated = { input, readOnly: false } as const;
  addTool(server, {
    ...gated,
    destructive: false,
    name: "publish_listing",
    title: "Publish a draft",
    description: `Publishes a draft listing so buyers can see it. ${LISTING_FEE_NOTE} ${confirm}`,
    run: (args) =>
      changeListingState(deps, args, {
        tool: "publish_listing",
        from: ["draft"],
        to: "active",
        what: "published",
        fee: LISTING_FEE_NOTE,
        needsPhoto: true,
      }),
  });
  addTool(server, {
    ...gated,
    destructive: false,
    name: "renew_listing",
    title: "Renew a listing",
    description: `Makes an expired, sold-out or deactivated listing active again. ${LISTING_FEE_NOTE} ${confirm}`,
    run: (args) =>
      changeListingState(deps, args, {
        tool: "renew_listing",
        from: ["expired", "sold_out", "inactive"],
        to: "active",
        what: "renewed",
        fee: `${LISTING_FEE_NOTE} (Reactivating a deactivated listing that hasn't expired may be free.)`,
        needsPhoto: true,
      }),
  });
  addTool(server, {
    ...gated,
    destructive: true,
    name: "deactivate_listing",
    title: "Deactivate a listing",
    description: `Hides an active listing from buyers (it can be renewed later). ${confirm}`,
    run: (args) =>
      changeListingState(deps, args, {
        tool: "deactivate_listing",
        from: ["active"],
        to: "inactive",
        what: "deactivated",
        fee: null,
        needsPhoto: false,
      }),
  });
  addTool(server, {
    ...gated,
    destructive: true,
    name: "delete_listing",
    title: "Delete a listing",
    description: `Deletes a listing permanently. ${confirm}`,
    run: (args) => deleteListing(deps, args),
  });
  addTool(server, {
    name: "remove_listing_image",
    title: "Remove a photo",
    description: `Removes one photo (listing_image_id from get_listing) from a listing. ${confirm}`,
    input: z.object({
      listing_id: LISTING_ID,
      listing_image_id: z.number().int().positive(),
      confirmation_token: TOKEN,
    }),
    readOnly: false,
    destructive: true,
    run: (args) => removeListingImage(deps, args),
  });
}
