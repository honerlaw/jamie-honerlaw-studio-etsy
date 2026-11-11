import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { changeListingState } from "../src/tools/listings/change-listing-state";
import { deleteListing } from "../src/tools/listings/delete-listing";
import { removeListingImage } from "../src/tools/listings/remove-listing-image";
import { markOrderShipped } from "../src/tools/orders/mark-order-shipped";
import type { ShopToolDeps } from "../src/tools/shop-tool-deps";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { LISTING_PATCH_ROUTE, LISTING_ROUTE, RECEIPT_ROUTE, listing, receipt } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";
import { resultText as text } from "./support/tool-result";

// Gated tools whose preview stops the change, and confirmed writes Etsy refuses.

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
  etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
  etsy.routes.set(LISTING_PATCH_ROUTE, () => Response.json(listing({ state: "active" })));
  etsy.routes.set(RECEIPT_ROUTE, () => Response.json(receipt()));
  etsy.routes.set("POST /v3/application/shops/2002/receipts/777/tracking", () => Response.json(receipt()));
});

function json(result: CallToolResult): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text(result)));
}

const state = (tool: string, from: string[], to: "active" | "inactive") => (deps: ShopToolDeps) =>
  changeListingState(deps, { listing_id: 555 }, { tool, from, to, what: tool, fee: null, needsPhoto: true });

describe("previews that stop the change", () => {
  it.each([
    ["publish of a listing that isn't a draft", "active", "can't be published_listing"],
    ["publish without photos", "draft", "no photos"],
  ])("refuses %s, with no token and no write", async (_case, listingState, message) => {
    etsy.routes.set(LISTING_ROUTE, () =>
      Response.json(listing({ state: listingState, ...(message === "no photos" ? { images: [] } : {}) })),
    );
    const result = await state("publish_listing", ["draft"], "active")(toolDeps());
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("confirmation_token");
    expect(etsy.writes()).toHaveLength(0);
  });

  it("refuses a listing from another shop", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ shop_id: 9 })));
    expect(text(await deleteListing(toolDeps(), { listing_id: 555 }))).toContain("isn't in her shop");
  });

  it("refuses a photo that isn't on the listing", async () => {
    const result = await removeListingImage(toolDeps(), { listing_id: 555, listing_image_id: 99 });
    expect(text(result)).toContain("isn't on this listing");
  });

  it("warns when removing an active listing's only photo, and when an order is already shipped", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ state: "active" })));
    expect(text(await removeListingImage(toolDeps(), { listing_id: 555, listing_image_id: 9 }))).toContain(
      "only photo",
    );
    etsy.routes.set(RECEIPT_ROUTE, () => Response.json(receipt({ is_shipped: true })));
    const shipped = await markOrderShipped(toolDeps(), {
      receipt_id: 777,
      tracking_code: "1",
      carrier_name: "ups",
      note_to_buyer: "Thanks!",
    });
    expect(text(shipped)).toContain("already marked shipped");
    expect(text(shipped)).toContain("Thanks!");
  });

  it("passes Etsy failures through without writing", async () => {
    etsy.routes.set(RECEIPT_ROUTE, () => new Response("{}", { status: 404 }));
    expect(text(await markOrderShipped(toolDeps(), { receipt_id: 777, tracking_code: "1", carrier_name: "ups" }))).toBe(
      "Etsy couldn't find that.",
    );
    etsy.routes.set(RECEIPT_ROUTE, () => Response.json({ receipt_id: "x" }));
    expect(
      (await markOrderShipped(toolDeps(), { receipt_id: 777, tracking_code: "1", carrier_name: "ups" })).isError,
    ).toBe(true);
    expect(etsy.writes()).toHaveLength(0);
  });
});

describe("gated writes that Etsy refuses, and optional fields", () => {
  it.each([
    [
      "publish_listing",
      LISTING_PATCH_ROUTE,
      (deps: ShopToolDeps, token?: string) =>
        changeListingState(
          deps,
          { listing_id: 555, confirmation_token: token },
          { tool: "publish_listing", from: ["draft"], to: "active", what: "published", fee: "a fee", needsPhoto: true },
        ),
    ],
    [
      "delete_listing",
      "DELETE /v3/application/listings/555",
      (deps: ShopToolDeps, token?: string) => deleteListing(deps, { listing_id: 555, confirmation_token: token }),
    ],
    [
      "remove_listing_image",
      "DELETE /v3/application/shops/2002/listings/555/images/9",
      (deps: ShopToolDeps, token?: string) =>
        removeListingImage(deps, { listing_id: 555, listing_image_id: 9, confirmation_token: token }),
    ],
    [
      "mark_order_shipped",
      "POST /v3/application/shops/2002/receipts/777/tracking",
      (deps: ShopToolDeps, token?: string) =>
        markOrderShipped(deps, { receipt_id: 777, tracking_code: "1", carrier_name: "ups", confirmation_token: token }),
    ],
  ] as const)("%s reports the refusal", async (_name, route, run) => {
    etsy.routes.set(route, () => new Response(null, { status: 409 }));
    const deps = toolDeps();
    const first = await run(deps);
    const token = z.string().parse(json(first)["confirmation_token"]);
    if (_name === "publish_listing") {
      expect(json(first)["preview"]).toMatchObject({ fee: "a fee", photos: 1 });
    }
    expect(text(await run(deps, token))).toContain("HTTP 409");
  });

  it("handles listings whose photos Etsy omits", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ state: "active", images: null })));
    const deactivate = await changeListingState(
      toolDeps(),
      { listing_id: 555 },
      {
        tool: "deactivate_listing",
        from: ["active"],
        to: "inactive",
        what: "deactivated",
        fee: null,
        needsPhoto: false,
      },
    );
    expect(json(deactivate)["preview"]).toMatchObject({ photos: 0 });
    expect(json(deactivate)["preview"]).not.toHaveProperty("fee");
    expect(text(await removeListingImage(toolDeps(), { listing_id: 555, listing_image_id: 9 }))).toContain(
      "isn't on this listing",
    );
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ images: null })));
    expect(
      text(
        await changeListingState(
          toolDeps(),
          { listing_id: 555 },
          { tool: "publish_listing", from: ["draft"], to: "active", what: "published", fee: null, needsPhoto: true },
        ),
      ),
    ).toContain("no photos");
  });

  it("warns that renewing a sold-out listing sets its quantity to 1", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ state: "sold_out", quantity: 0 })));
    const renew = {
      tool: "renew_listing",
      from: ["sold_out"],
      to: "active",
      what: "renewed",
      fee: null,
      needsPhoto: true,
    } as const;
    expect(text(await changeListingState(toolDeps(), { listing_id: 555 }, renew))).toContain("quantity to 1");
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ state: "expired" })));
    expect(
      text(await changeListingState(toolDeps(), { listing_id: 555 }, { ...renew, from: ["expired"] as const })),
    ).not.toContain("quantity to 1");
  });

  it("reports a listing it can't read", async () => {
    etsy.routes.set(LISTING_ROUTE, () => new Response(null, { status: 404 }));
    expect(text(await removeListingImage(toolDeps(), { listing_id: 555, listing_image_id: 9 }))).toBe(
      "Etsy couldn't find that.",
    );
    expect(
      text(
        await changeListingState(
          toolDeps(),
          { listing_id: 555 },
          { tool: "renew_listing", from: ["expired"], to: "active", what: "renewed", fee: null, needsPhoto: true },
        ),
      ),
    ).toBe("Etsy couldn't find that.");
  });

  it("sends the note to the buyer only when given", async () => {
    const deps = toolDeps();
    const args = { receipt_id: 777, tracking_code: "1", carrier_name: "ups", note_to_buyer: "Thanks!" };
    const token = z.string().parse(json(await markOrderShipped(deps, args))["confirmation_token"]);
    await markOrderShipped(deps, { ...args, confirmation_token: token });
    expect(JSON.parse(etsy.writes()[0]?.body ?? "{}")).toStrictEqual({
      tracking_code: "1",
      carrier_name: "ups",
      note_to_buyer: "Thanks!",
    });
  });
});
