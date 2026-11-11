import { beforeEach, describe, expect, it } from "vitest";

import { createDraftListing } from "../src/tools/listings/create-draft-listing";
import { getListing } from "../src/tools/listings/get-listing";
import { listListings } from "../src/tools/listings/list-listings";
import { updateListing } from "../src/tools/listings/update-listing";
import { listProcessingProfiles } from "../src/tools/shop/list-processing-profiles";
import { listReturnPolicies } from "../src/tools/shop/list-return-policies";
import { listShippingProfiles } from "../src/tools/shop/list-shipping-profiles";
import { listShopSections } from "../src/tools/shop/list-shop-sections";
import { searchCategories } from "../src/tools/shop/search-categories";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { LISTING_PATCH_ROUTE, LISTING_ROUTE, listing } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";
import { resultJson, resultText } from "./support/tool-result";

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
});

describe("shop reads", () => {
  it.each([
    [
      "sections",
      "GET /v3/application/shops/2002/sections",
      { results: [{ shop_section_id: 1, title: "Mugs", rank: 1, active_listing_count: 4, user_id: 1001 }] },
      () => listShopSections(toolDeps()),
      [{ shop_section_id: 1, title: "Mugs", rank: 1, active_listing_count: 4 }],
    ],
    [
      "shipping profiles (deleted ones hidden)",
      "GET /v3/application/shops/2002/shipping-profiles",
      {
        results: [
          {
            shipping_profile_id: 1,
            title: "Standard",
            origin_country_iso: "US",
            profile_type: "manual",
            origin_postal_code: "x",
          },
          { shipping_profile_id: 2, title: "Old", is_deleted: true },
        ],
      },
      () => listShippingProfiles(toolDeps()),
      [{ shipping_profile_id: 1, title: "Standard", origin_country_iso: "US", profile_type: "manual" }],
    ],
    [
      "processing profiles",
      "GET /v3/application/shops/2002/readiness-state-definitions",
      {
        results: [
          { readiness_state_id: 7, readiness_state: "made_to_order", min_processing_days: 1, max_processing_days: 3 },
        ],
      },
      () => listProcessingProfiles(toolDeps()),
      [{ readiness_state_id: 7, readiness_state: "made_to_order", min_processing_days: 1, max_processing_days: 3 }],
    ],
    [
      "return policies",
      "GET /v3/application/shops/2002/policies/return",
      {
        results: [
          { return_policy_id: 3, accepts_returns: true, accepts_exchanges: false, return_deadline: 30, shop_id: 2002 },
        ],
      },
      () => listReturnPolicies(toolDeps()),
      [{ return_policy_id: 3, accepts_returns: true, accepts_exchanges: false, return_deadline: 30 }],
    ],
  ])("lists %s with only the allowlisted fields", async (_what, route, body, run, expected) => {
    etsy.routes.set(route, () => Response.json(body));
    expect(resultJson(await run())).toStrictEqual(expected);
    etsy.routes.set(route, () => new Response("{}", { status: 500 }));
    expect(resultText(await run())).toContain("Etsy is having trouble");
    etsy.routes.set(route, () => Response.json({ results: "nope" }));
    expect(resultText(await run())).toContain("unexpected shape");
  });

  it("finds categories by every word, leaves first", async () => {
    const tree = {
      results: [
        {
          id: 1,
          name: "Home & Living",
          children: [{ id: 2, name: "Kitchen", children: [{ id: 3, name: "Mugs", children: [] }] }],
        },
        { id: 4, name: "Mugs & Cups Supplies", children: null },
      ],
    };
    etsy.routes.set("GET /v3/application/seller-taxonomy/nodes", () => Response.json(tree));
    const found = resultJson<{ matches: { taxonomy_id: number; path: string }[]; more: boolean }>(
      await searchCategories(toolDeps(), { query: "kitchen  MUGS" }),
    );
    expect(found).toStrictEqual({
      matches: [{ taxonomy_id: 3, path: "Home & Living > Kitchen > Mugs", leaf: true }],
      more: false,
    });
    etsy.routes.set("GET /v3/application/seller-taxonomy/nodes", () =>
      Response.json({ results: Array.from({ length: 30 }, (_, id) => ({ id, name: `Mug ${String(id)}` })) }),
    );
    expect(resultJson<{ more: boolean }>(await searchCategories(toolDeps(), { query: "mug" })).more).toBe(true);
    etsy.routes.set("GET /v3/application/seller-taxonomy/nodes", () => Response.json({}));
    expect(resultText(await searchCategories(toolDeps(), { query: "mug" }))).toContain("unexpected shape");
    etsy.routes.set("GET /v3/application/seller-taxonomy/nodes", () => new Response(null, { status: 429 }));
    expect(resultText(await searchCategories(toolDeps(), { query: "mug" }))).toContain("rate-limiting");
  });
});

describe("listings", () => {
  it("lists a page in a state, newest first, with decimal prices", async () => {
    etsy.routes.set("GET /v3/application/shops/2002/listings", () =>
      Response.json({ count: 1, results: [listing({ ending_timestamp: 1_800_000_000 })] }),
    );
    const page = resultJson<{ results: { price: unknown; ending_timestamp: string }[] }>(
      await listListings(toolDeps(), { state: "draft", limit: 10, offset: 20 }),
    );
    expect(page.results[0]?.price).toStrictEqual({ amount: 24.5, currency_code: "USD" });
    expect(page.results[0]?.ending_timestamp).toBe("2027-01-15T08:00:00.000Z");
    const query = new URL(etsy.requests.at(-1)?.url ?? "").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ state: "draft", limit: "10", offset: "20", sort_order: "desc" });
    etsy.routes.set("GET /v3/application/shops/2002/listings", () => new Response(null, { status: 500 }));
    expect((await listListings(toolDeps(), { state: "active", limit: 1, offset: 0 })).isError).toBe(true);
  });

  it("gets one listing with photos, and without the shop id", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
    const got = resultJson<Record<string, unknown>>(await getListing(toolDeps(), { listing_id: 555 }));
    expect(got).toMatchObject({ listing_id: 555, images: [{ listing_image_id: 9 }] });
    expect(got).not.toHaveProperty("shop_id");
    expect(new URL(etsy.requests.at(-1)?.url ?? "").searchParams.get("includes")).toBe("Images");
    etsy.routes.set(LISTING_ROUTE, () => new Response(null, { status: 404 }));
    expect(resultText(await getListing(toolDeps(), { listing_id: 555 }))).toBe("Etsy couldn't find that.");
    etsy.routes.set(LISTING_ROUTE, () => Response.json({ listing_id: 555 }));
    expect(resultText(await getListing(toolDeps(), { listing_id: 555 }))).toContain("unexpected shape");
  });

  it("creates a physical draft with a form body and comma-joined tags", async () => {
    etsy.routes.set("POST /v3/application/shops/2002/listings", () => Response.json(listing()));
    const created = await createDraftListing(toolDeps(), {
      title: "Blue mug",
      description: "d",
      price: 24.5,
      quantity: 3,
      who_made: "i_did",
      when_made: "made_to_order",
      taxonomy_id: 3,
      is_supply: false,
      tags: ["mug", "blue glaze"],
      shipping_profile_id: undefined,
    });
    expect(resultJson<{ created: { listing_id: number } }>(created).created.listing_id).toBe(555);
    const sent = etsy.writes()[0];
    expect(sent?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(sent?.body);
    expect(form.get("tags")).toBe("mug,blue glaze");
    expect(form.get("type")).toBe("physical");
    expect(form.get("price")).toBe("24.5");
    expect(form.has("shipping_profile_id")).toBe(false);
    expect(form.has("materials")).toBe(false);
    etsy.routes.set("POST /v3/application/shops/2002/listings", () => Response.json({ odd: true }));
    const args = {
      title: "t",
      description: "d",
      price: 1,
      quantity: 1,
      who_made: "i_did",
      when_made: "made_to_order",
      taxonomy_id: 3,
      is_supply: false,
    } as const;
    expect(resultJson<{ created: unknown }>(await createDraftListing(toolDeps(), args)).created).toBeNull();
    etsy.routes.set("POST /v3/application/shops/2002/listings", () => new Response(null, { status: 400 }));
    expect(
      resultText(
        await createDraftListing(toolDeps(), {
          title: "t",
          description: "d",
          price: 1,
          quantity: 1,
          who_made: "i_did",
          when_made: "made_to_order",
          taxonomy_id: 3,
          is_supply: false,
        }),
      ),
    ).toContain("HTTP 400");
  });

  it("updates only the given fields, and needs at least one", async () => {
    etsy.routes.set(LISTING_PATCH_ROUTE, () => Response.json(listing({ title: "Green mug" })));
    const updated = resultJson<{ title: string }>(
      await updateListing(toolDeps(), { listing_id: 555, title: "Green mug", tags: undefined }),
    );
    expect(updated.title).toBe("Green mug");
    expect(new URLSearchParams(etsy.writes()[0]?.body).toString()).toBe("title=Green+mug");
    expect((await updateListing(toolDeps(), { listing_id: 555 })).isError).toBe(true);
    etsy.routes.set(LISTING_PATCH_ROUTE, () => new Response(null, { status: 403 }));
    expect(resultText(await updateListing(toolDeps(), { listing_id: 555, title: "x" }))).toContain("isn't allowed");
  });
});
