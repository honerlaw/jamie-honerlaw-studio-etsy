import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CONFIRM_INSTRUCTIONS } from "../tools/confirm/run-gated";
import { createDraftListing } from "../tools/listings/create-draft-listing";
import { getListing } from "../tools/listings/get-listing";
import {
  LISTING_ID,
  OPTIONAL_LISTING_FIELDS,
  TAGS,
  MATERIALS,
  WHEN_MADE,
  WHO_MADE,
} from "../tools/listings/listing-fields";
import { listListings } from "../tools/listings/list-listings";
import { updateListing } from "../tools/listings/update-listing";
import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { addTool } from "./add-tool";
import { registerGatedListingTools } from "./register-gated-listing-tools";
import { registerPhotoTools } from "./register-photo-tools";

// Listing reads and edits. Drafts and edits run directly; anything that costs a fee or
// can't be undone is registered by registerGatedListingTools.
export function registerListingTools(server: McpServer, deps: ShopToolDeps): void {
  addTool(server, {
    name: "list_listings",
    title: "List listings",
    description: "One page of her listings in a state (newest first), with price, quantity, views and favorites.",
    input: z.object({
      state: z.enum(["active", "inactive", "draft", "expired", "sold_out"]).default("active"),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    readOnly: true,
    destructive: false,
    run: (args) => listListings(deps, args),
  });
  addTool(server, {
    name: "get_listing",
    title: "Get a listing",
    description: "One listing in full: text, tags, settings, photos (with their listing_image_id) and stats.",
    input: z.object({ listing_id: LISTING_ID }),
    readOnly: true,
    destructive: false,
    run: (args) => getListing(deps, args),
  });
  addTool(server, {
    name: "create_draft_listing",
    title: "Create a draft listing",
    description:
      "Creates a physical listing as a draft (free, not visible to buyers). Then add photos " +
      "(request_photo_upload) and publish it (publish_listing). Prices are in the shop's currency.",
    input: z.object({
      title: z.string().trim().min(1).max(140),
      description: z.string().min(1),
      price: z.number().positive().describe("Price in the shop's currency, e.g. 24.5."),
      quantity: z.number().int().min(1).max(999),
      who_made: WHO_MADE,
      when_made: WHEN_MADE,
      taxonomy_id: z.number().int().positive().describe("A category id from search_categories."),
      is_supply: z.boolean().default(false),
      tags: TAGS.optional(),
      materials: MATERIALS.optional(),
      shop_section_id: OPTIONAL_LISTING_FIELDS.shop_section_id,
      shipping_profile_id: OPTIONAL_LISTING_FIELDS.shipping_profile_id,
      return_policy_id: OPTIONAL_LISTING_FIELDS.return_policy_id,
      readiness_state_id: OPTIONAL_LISTING_FIELDS.readiness_state_id,
    }),
    readOnly: false,
    destructive: false,
    run: (args) => createDraftListing(deps, args),
  });
  addTool(server, {
    name: "update_listing",
    title: "Edit a listing",
    description:
      "Changes a listing's title, description, tags, materials, category, section or profiles. Only the fields " +
      "given change. Price and quantity: use update_listing_inventory.",
    input: z.object({
      listing_id: LISTING_ID,
      title: z.string().trim().min(1).max(140).optional(),
      should_auto_renew: z.boolean().optional(),
      ...OPTIONAL_LISTING_FIELDS,
    }),
    readOnly: false,
    destructive: false,
    run: (args) => updateListing(deps, args),
  });
  registerPhotoTools(server, deps);
  registerGatedListingTools(server, deps, CONFIRM_INSTRUCTIONS);
}
