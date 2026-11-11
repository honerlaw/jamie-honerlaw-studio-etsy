import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { argsHash } from "../src/tools/confirm/args-hash";
import { canonicalJson } from "../src/tools/confirm/canonical-json";
import { changeListingState } from "../src/tools/listings/change-listing-state";
import { deleteListing } from "../src/tools/listings/delete-listing";
import { removeListingImage } from "../src/tools/listings/remove-listing-image";
import { markOrderShipped } from "../src/tools/orders/mark-order-shipped";
import type { ShopToolDeps } from "../src/tools/shop-tool-deps";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { LISTING_PATCH_ROUTE, LISTING_ROUTE, RECEIPT_ROUTE, listing, receipt } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
  etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
  etsy.routes.set(LISTING_PATCH_ROUTE, () => Response.json(listing({ state: "active" })));
  etsy.routes.set("DELETE /v3/application/listings/555", () => new Response(null, { status: 204 }));
  etsy.routes.set("DELETE /v3/application/shops/2002/listings/555/images/9", () => new Response(null, { status: 204 }));
  etsy.routes.set(RECEIPT_ROUTE, () => Response.json(receipt()));
  etsy.routes.set("POST /v3/application/shops/2002/receipts/777/tracking", () => Response.json(receipt()));
});

type Run = (deps: ShopToolDeps, args: Record<string, unknown>) => Promise<CallToolResult>;

const state =
  (tool: string, from: string[], to: "active" | "inactive"): Run =>
  (deps, args) =>
    changeListingState(deps, { listing_id: 555, ...args }, { tool, from, to, what: tool, fee: null, needsPhoto: true });

interface GatedCase {
  readonly name: string;
  readonly run: Run;
  readonly args: Record<string, unknown>;
  readonly listingState: string;
  readonly write: string;
  readonly changed: Record<string, unknown>;
}

const CASES: readonly GatedCase[] = [
  {
    name: "publish_listing",
    run: state("publish_listing", ["draft"], "active"),
    args: {},
    listingState: "draft",
    write: LISTING_PATCH_ROUTE,
    changed: { listing_id: 556 },
  },
  {
    name: "renew_listing",
    run: state("renew_listing", ["expired"], "active"),
    args: {},
    listingState: "expired",
    write: LISTING_PATCH_ROUTE,
    changed: { listing_id: 556 },
  },
  {
    name: "deactivate_listing",
    run: state("deactivate_listing", ["active"], "inactive"),
    args: {},
    listingState: "active",
    write: LISTING_PATCH_ROUTE,
    changed: { listing_id: 556 },
  },
  {
    name: "delete_listing",
    run: (deps, args) => deleteListing(deps, { listing_id: 555, ...args }),
    args: {},
    listingState: "draft",
    write: "DELETE /v3/application/listings/555",
    changed: { listing_id: 556 },
  },
  {
    name: "remove_listing_image",
    run: (deps, args) => removeListingImage(deps, { listing_id: 555, listing_image_id: 9, ...args }),
    args: {},
    listingState: "active",
    write: "DELETE /v3/application/shops/2002/listings/555/images/9",
    changed: { listing_image_id: 10 },
  },
  {
    name: "mark_order_shipped",
    run: (deps, args) =>
      markOrderShipped(deps, { receipt_id: 777, tracking_code: "1Z999", carrier_name: "ups", ...args }),
    args: {},
    listingState: "draft",
    write: "POST /v3/application/shops/2002/receipts/777/tracking",
    changed: { tracking_code: "1Z000" },
  },
];

function json(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  return block?.type === "text" ? z.record(z.string(), z.unknown()).parse(JSON.parse(block.text)) : {};
}

async function preview(gated: GatedCase, deps: ShopToolDeps): Promise<string> {
  const result = await gated.run(deps, gated.args);
  expect(result.isError).toBeUndefined();
  return z.string().parse(json(result)["confirmation_token"]);
}

const writeKeys = () => etsy.writes().map((request) => `${request.method} ${new URL(request.url).pathname}`);

describe.each(CASES)("$name", (gated) => {
  beforeEach(() => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ state: gated.listingState })));
  });

  it("previews with a token, at most 2 Etsy reads and 0 writes", async () => {
    const result = await gated.run(toolDeps(), gated.args);
    expect(json(result)).toHaveProperty("preview");
    expect(json(result)["confirmation_token"]).toMatch(/^[\w-]{22}$/u);
    expect(etsy.writes()).toHaveLength(0);
    expect(etsy.reads().length).toBeLessThanOrEqual(2);
  });

  it("makes exactly the previewed write on the confirmed call", async () => {
    const deps = toolDeps();
    const token = await preview(gated, deps);
    const result = await gated.run(deps, { ...gated.args, confirmation_token: token });
    expect(result.isError).toBeUndefined();
    expect(writeKeys()).toStrictEqual([gated.write]);
  });

  it("refuses a token with changed arguments, a reused token, an expired one and a made-up one", async () => {
    const deps = toolDeps();
    const changedToken = await preview(gated, deps);
    expect((await gated.run(deps, { ...gated.args, ...gated.changed, confirmation_token: changedToken })).isError).toBe(
      true,
    );
    const reused = await preview(gated, deps);
    await gated.run(deps, { ...gated.args, confirmation_token: reused });
    const before = etsy.writes().length;
    expect((await gated.run(deps, { ...gated.args, confirmation_token: reused })).isError).toBe(true);
    const expired = await preview(gated, deps);
    const stored = await deps.store.peek(`confirm:${expired}`);
    await deps.store.put(`confirm:${expired}`, stored?.value ?? "", -1);
    expect((await gated.run(deps, { ...gated.args, confirmation_token: expired })).isError).toBe(true);
    expect((await gated.run(deps, { ...gated.args, confirmation_token: "made-up" })).isError).toBe(true);
    expect(etsy.writes()).toHaveLength(before);
    expect(before).toBe(1);
  });
});

describe("the arguments hash", () => {
  const schema = z.object({
    listing_id: z.number(),
    note: z.string().default(""),
    nested: z.object({ b: z.number(), a: z.number() }),
  });

  it("is equal for reordered keys and for omitted versus spelled-out defaults, and ignores the token", async () => {
    const one = schema.parse({ listing_id: 1, nested: { b: 2, a: 1 } });
    const two = schema.parse({ nested: { a: 1, b: 2 }, note: "", listing_id: 1 });
    expect(await argsHash(one)).toBe(await argsHash(two));
    expect(await argsHash({ ...one, confirmation_token: "x" })).toBe(await argsHash(one));
    expect(await argsHash({ ...one, note: "x" })).not.toBe(await argsHash(one));
  });

  it("serializes canonically", () => {
    expect(canonicalJson({ b: [1, "x", null, undefined], a: { d: true, c: undefined } })).toBe(
      '{"a":{"d":true},"b":[1,"x",null,null]}',
    );
    expect(canonicalJson(undefined)).toBe("null");
  });
});
