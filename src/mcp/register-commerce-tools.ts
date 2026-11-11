import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CONFIRM_INSTRUCTIONS } from "../tools/confirm/run-gated";
import { getListingStats } from "../tools/insights/get-listing-stats";
import { getSalesSummary } from "../tools/insights/get-sales-summary";
import { getViewsTrend } from "../tools/insights/get-views-trend";
import { listReviews } from "../tools/insights/list-reviews";
import { METRICS_NOTE } from "../tools/insights/metrics-note";
import { getListingInventory } from "../tools/inventory/get-listing-inventory";
import { updateListingInventory } from "../tools/inventory/update-listing-inventory";
import { LISTING_ID } from "../tools/listings/listing-fields";
import { getOrder } from "../tools/orders/get-order";
import { listOrders } from "../tools/orders/list-orders";
import { markOrderShipped } from "../tools/orders/mark-order-shipped";
import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { addTool } from "./add-tool";

const DAY = z.iso.date().describe("A UTC date, YYYY-MM-DD.");

// Inventory and pricing, orders and shipping, and the numbers.
export function registerCommerceTools(server: McpServer, deps: ShopToolDeps): void {
  addTool(server, {
    name: "get_listing_inventory",
    title: "Prices and stock",
    description: "A listing's products (one per variation), each with SKU, price and quantity.",
    input: z.object({ listing_id: LISTING_ID }),
    readOnly: true,
    destructive: false,
    run: (args) => getListingInventory(deps, args),
  });
  addTool(server, {
    name: "update_listing_inventory",
    title: "Change prices or stock",
    description:
      "Changes price, quantity, SKU or availability for some of a listing's products (product_id and " +
      "offering_id from get_listing_inventory). Everything not named stays exactly as it was.",
    input: z.object({
      listing_id: LISTING_ID,
      changes: z
        .array(
          z.object({
            product_id: z.number().int().positive(),
            offering_id: z
              .number()
              .int()
              .positive()
              .optional()
              .describe("Omit to change all of the product's offerings."),
            sku: z.string().max(32).optional(),
            price: z.number().positive().optional(),
            quantity: z.number().int().min(0).max(999).optional(),
            is_enabled: z.boolean().optional(),
          }),
        )
        .min(1),
    }),
    readOnly: false,
    destructive: false,
    run: (args) => updateListingInventory(deps, args),
  });
  addTool(server, {
    name: "list_orders",
    title: "List orders",
    description:
      "Her orders, newest first: unshipped (paid, waiting to ship), paid, or all, optionally between two dates. " +
      "Shows buyer name and country, not email or street address (get_order has the address).",
    input: z.object({
      filter: z.enum(["unshipped", "paid", "all"]).default("unshipped"),
      from: DAY.optional(),
      to: DAY.optional(),
      limit: z.number().int().min(1).max(300).default(50),
    }),
    readOnly: true,
    destructive: false,
    run: (args) => listOrders(deps, args),
  });
  addTool(server, {
    name: "get_order",
    title: "Get an order",
    description:
      "One order (receipt_id) in full: items, totals, buyer's message and shipments. The shipping address only " +
      "when include_address is true; use that only when she needs it, e.g. to write a label.",
    input: z.object({ receipt_id: z.number().int().positive(), include_address: z.boolean().default(false) }),
    readOnly: true,
    destructive: false,
    run: (args) => getOrder(deps, args),
  });
  addTool(server, {
    name: "mark_order_shipped",
    title: "Mark an order shipped",
    description: `Adds tracking to an order and marks it shipped; Etsy emails the buyer. ${CONFIRM_INSTRUCTIONS}`,
    input: z.object({
      receipt_id: z.number().int().positive(),
      tracking_code: z.string().trim().min(1),
      carrier_name: z.string().trim().min(1).describe("e.g. usps, ups, fedex, dhl."),
      note_to_buyer: z.string().max(500).optional(),
      confirmation_token: z.string().optional().describe("Only on the confirmed second call."),
    }),
    readOnly: false,
    destructive: true,
    run: (args) => markOrderShipped(deps, args),
  });
  addTool(server, {
    name: "get_sales_summary",
    title: "Sales summary",
    description: `Revenue, number of orders and best-selling listings between two dates. ${METRICS_NOTE}`,
    input: z.object({ from: DAY, to: DAY }),
    readOnly: true,
    destructive: false,
    run: (args) => getSalesSummary(deps, args),
  });
  addTool(server, {
    name: "get_listing_stats",
    title: "Listing stats",
    description: `Lifetime views and favorites for one listing. ${METRICS_NOTE}`,
    input: z.object({ listing_id: LISTING_ID }),
    readOnly: true,
    destructive: false,
    run: (args) => getListingStats(deps, args),
  });
  addTool(server, {
    name: "list_reviews",
    title: "Reviews",
    description: "Her shop's reviews, newest first: rating, text and listing.",
    input: z.object({
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    readOnly: true,
    destructive: false,
    run: (args) => listReviews(deps, args),
  });
  addTool(server, {
    name: "get_views_trend",
    title: "Views over time",
    description:
      "Daily new views across the shop and the listings gaining the most, from this server's own daily " +
      `snapshots. ${METRICS_NOTE}`,
    input: z.object({ days: z.number().int().min(2).max(90).default(14) }),
    readOnly: true,
    destructive: false,
    run: (args) => getViewsTrend(deps, args),
  });
}
