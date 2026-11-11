import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

import { definedFields } from "../../etsy/defined-fields";
import { LISTING_SUMMARY } from "../../etsy/shapes/listing";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import type { WHEN_MADE, WHO_MADE } from "./listing-fields";

export interface CreateDraftArgs {
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly quantity: number;
  readonly who_made: z.output<typeof WHO_MADE>;
  readonly when_made: z.output<typeof WHEN_MADE>;
  readonly taxonomy_id: number;
  readonly is_supply: boolean;
  readonly tags?: readonly string[] | undefined;
  readonly materials?: readonly string[] | undefined;
  readonly shop_section_id?: number | undefined;
  readonly shipping_profile_id?: number | undefined;
  readonly return_policy_id?: number | undefined;
  readonly readiness_state_id?: number | undefined;
}

// Creates a physical draft listing. Drafts are free and invisible to buyers; publishing
// (with photos, a shipping profile, a processing profile and a return policy) is a
// separate, confirmed step.
export async function createDraftListing(deps: ShopToolDeps, args: CreateDraftArgs): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).POST("/v3/application/shops/{shop_id}/listings", {
      params: { path: { shop_id: Number(deps.shopId) } },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: definedFields({
        ...args,
        tags: args.tags?.slice(),
        materials: args.materials?.slice(),
        type: "physical" as const,
      }),
    });
    if (!response.ok) {
      return etsyError(response);
    }
    const listing = LISTING_SUMMARY.safeParse(data);
    return toolText({
      created: listing.success ? listing.data : null,
      next_steps:
        "Add photos with request_photo_upload, check it with get_listing, then publish_listing when she's ready.",
    });
  });
}
