import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getShopOverview } from "../tools/get-shop-overview";
import { listProcessingProfiles } from "../tools/shop/list-processing-profiles";
import { listReturnPolicies } from "../tools/shop/list-return-policies";
import { listShippingProfiles } from "../tools/shop/list-shipping-profiles";
import { listShopSections } from "../tools/shop/list-shop-sections";
import { searchCategories } from "../tools/shop/search-categories";
import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { addTool } from "./add-tool";

const NONE = z.object({});

// Shop-level reads: the overview and the ids a listing needs.
export function registerShopTools(server: McpServer, deps: ShopToolDeps): void {
  const read = { input: NONE, readOnly: true, destructive: false } as const;
  addTool(server, {
    ...read,
    name: "get_shop_overview",
    title: "Shop overview",
    description:
      "Her Etsy shop's basics (name, currency, active listings, sales, reviews, vacation mode) and the health " +
      "of this connection: when the Etsy sign-in was last refreshed and when the daily stats snapshot last ran.",
    run: () => getShopOverview(deps),
  });
  addTool(server, {
    ...read,
    name: "list_shop_sections",
    title: "Shop sections",
    description: "The sections her shop's listings are grouped into, with their ids (shop_section_id).",
    run: () => listShopSections(deps),
  });
  addTool(server, {
    ...read,
    name: "list_shipping_profiles",
    title: "Shipping profiles",
    description: "Her shipping profiles and their ids. A physical listing needs one (shipping_profile_id) to publish.",
    run: () => listShippingProfiles(deps),
  });
  addTool(server, {
    ...read,
    name: "list_processing_profiles",
    title: "Processing profiles",
    description:
      "Her processing profiles (how long items take to make or ship) and their ids. A physical listing needs " +
      "one (readiness_state_id) to publish.",
    run: () => listProcessingProfiles(deps),
  });
  addTool(server, {
    ...read,
    name: "list_return_policies",
    title: "Return policies",
    description: "Her return policies and their ids. A physical listing needs one (return_policy_id) to publish.",
    run: () => listReturnPolicies(deps),
  });
  addTool(server, {
    ...read,
    input: z.object({ query: z.string().min(2).describe("Words to find, e.g. 'ceramic mug'.") }),
    name: "search_categories",
    title: "Find a category",
    description:
      "Searches Etsy's category list for a listing's taxonomy_id. Returns matching category paths; prefer a " +
      "leaf (the most specific).",
    run: (args) => searchCategories(deps, args),
  });
}
