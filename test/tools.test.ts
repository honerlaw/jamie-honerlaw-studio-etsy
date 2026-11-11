import { beforeEach, describe, expect, it } from "vitest";

import { TOOL_OPERATIONS } from "../src/auth/etsy-scopes";
import { mockEtsy } from "./support/etsy-mock";
import { connect, mcp } from "./support/oauth-flow";

interface Listed {
  readonly name: string;
  readonly description?: string;
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly destructiveHint?: boolean };
  readonly _meta?: Record<string, unknown>;
}

const GATED = [
  "publish_listing",
  "renew_listing",
  "deactivate_listing",
  "delete_listing",
  "remove_listing_image",
  "mark_order_shipped",
];

let tools: readonly Listed[];

beforeEach(async () => {
  mockEtsy();
  const { accessToken } = await connect();
  const response = await mcp(accessToken, "tools/list");
  tools = (await response.json<{ result: { tools: Listed[] } }>()).result.tools;
});

describe("tools/list", () => {
  it("is exactly the tool set in TOOL_OPERATIONS (less the sign-in and the cron)", () => {
    const expected = Object.keys(TOOL_OPERATIONS).filter(
      (name) => name !== "sign_in" && name !== "daily_views_snapshot",
    );
    expect(tools.map((tool) => tool.name).sort()).toStrictEqual(expected.sort());
    expect(tools).toHaveLength(27);
  });

  it("gives every tool both hints, read-only tools never destructive", () => {
    for (const tool of tools) {
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean");
      if (tool.annotations?.readOnlyHint === true) {
        expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      }
    }
  });

  it("tells the model how to confirm every gated tool, and only those", () => {
    for (const tool of tools) {
      expect(tool.description?.includes("WITHOUT confirmation_token"), tool.name).toBe(GATED.includes(tool.name));
    }
  });

  it("declares ChatGPT's file param on add_listing_image", () => {
    expect(tools.find((tool) => tool.name === "add_listing_image")?._meta).toStrictEqual({
      "openai/fileParams": ["image"],
    });
  });
});

// Valid arguments for every tool. Etsy is mocked only for sign-in, so most calls end in
// an Etsy error result; the point is that each registered tool parses its arguments and
// runs its handler through the MCP protocol.
const ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  get_shop_overview: {},
  list_shop_sections: {},
  list_shipping_profiles: {},
  list_processing_profiles: {},
  list_return_policies: {},
  search_categories: { query: "mug" },
  list_listings: {},
  get_listing: { listing_id: 555 },
  create_draft_listing: {
    title: "Mug",
    description: "d",
    price: 10,
    quantity: 1,
    who_made: "i_did",
    when_made: "made_to_order",
    taxonomy_id: 3,
  },
  update_listing: { listing_id: 555, title: "New" },
  request_photo_upload: { listing_id: 555 },
  attach_uploaded_photos: { listing_id: 555 },
  add_listing_image: { listing_id: 555, image: "placeholder" },
  publish_listing: { listing_id: 555 },
  renew_listing: { listing_id: 555 },
  deactivate_listing: { listing_id: 555 },
  delete_listing: { listing_id: 555 },
  remove_listing_image: { listing_id: 555, listing_image_id: 9 },
  get_listing_inventory: { listing_id: 555 },
  update_listing_inventory: { listing_id: 555, changes: [{ product_id: 1, price: 2 }] },
  list_orders: {},
  get_order: { receipt_id: 777 },
  mark_order_shipped: { receipt_id: 777, tracking_code: "1Z", carrier_name: "ups" },
  get_sales_summary: { from: "2026-11-01", to: "2026-11-10" },
  get_listing_stats: { listing_id: 555 },
  list_reviews: {},
  get_views_trend: {},
};

describe("tools/call", () => {
  it("runs every tool through the protocol with valid arguments", async () => {
    const { accessToken } = await connect();
    expect(Object.keys(ARGS).sort()).toStrictEqual(tools.map((tool) => tool.name).sort());
    for (const [name, args] of Object.entries(ARGS)) {
      const response = await mcp(accessToken, "tools/call", { name, arguments: args });
      const body = await response.json<{ result?: { content: { text: string }[] }; error?: unknown }>();
      expect(body.error, name).toBeUndefined();
      expect(body.result?.content[0]?.text, name).not.toContain("Something went wrong");
    }
  });

  it("rejects arguments that don't match the schema", async () => {
    const { accessToken } = await connect();
    const response = await mcp(accessToken, "tools/call", { name: "get_listing", arguments: { listing_id: "x" } });
    expect(JSON.stringify(await response.json())).toContain("isError");
  });
});
