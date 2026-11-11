import { beforeEach, describe, expect, it } from "vitest";

import { moneyToDecimal } from "../src/etsy/money-to-decimal";
import { INVENTORY } from "../src/etsy/shapes/inventory";
import { getListingInventory } from "../src/tools/inventory/get-listing-inventory";
import { updateListingInventory } from "../src/tools/inventory/update-listing-inventory";
import { writableInventory } from "../src/tools/inventory/writable-inventory";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { toolDeps } from "./support/tool-deps";
import { resultJson, resultText } from "./support/tool-result";

const ROUTE = "GET /v3/application/listings/555/inventory";
const PUT = "PUT /v3/application/listings/555/inventory";

function product(
  id: number,
  color: string,
  amount: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    product_id: id,
    sku: `MUG-${color}`,
    is_deleted: false,
    property_values: [{ property_id: 200, property_name: "Color", scale_id: null, value_ids: [id], values: [color] }],
    offerings: [
      {
        offering_id: id * 10,
        quantity: 4,
        is_enabled: true,
        is_deleted: false,
        price: { amount, divisor: 100, currency_code: "USD" },
        readiness_state_id: 7,
      },
    ],
    ...extra,
  };
}

const READ = {
  products: [product(1, "Blue", 2450), product(2, "Green", 1999), product(3, "Red", 1000, { is_deleted: true })],
  price_on_property: [200],
  quantity_on_property: [],
  sku_on_property: [200],
  readiness_state_on_property: [],
};

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
  etsy.routes.set(ROUTE, () => Response.json(READ));
  etsy.routes.set(PUT, () => Response.json(READ));
});

describe("prices", () => {
  it.each([
    [{ amount: 1999, divisor: 100 }, 19.99],
    [{ amount: 2450, divisor: 100 }, 24.5],
    [{ amount: 1, divisor: 100 }, 0.01],
    [{ amount: 12_345, divisor: 1000 }, 12.345],
    [{ amount: 500, divisor: 1 }, 500],
  ])("turns %o into %d and back", (money, decimal) => {
    expect(moneyToDecimal(money)).toBe(decimal);
    expect(Math.round(decimal * money.divisor)).toBe(money.amount);
  });
});

describe("update_listing_inventory", () => {
  it("writes untouched products and offerings back exactly as read", async () => {
    await updateListingInventory(toolDeps(), { listing_id: 555, changes: [{ product_id: 1, price: 26 }] });
    const body = JSON.parse(etsy.writes()[0]?.body ?? "{}") as { products: unknown[] } & Record<string, unknown>;
    const untouched = body.products[1];
    expect(untouched).toStrictEqual(writableInventory(INVENTORY.parse(READ), []).products[1]);
    expect(untouched).toStrictEqual({
      sku: "MUG-Green",
      property_values: [{ property_id: 200, property_name: "Color", value_ids: [2], values: ["Green"] }],
      offerings: [{ price: 19.99, quantity: 4, is_enabled: true, readiness_state_id: 7 }],
    });
    expect(body.products).toHaveLength(2);
    expect(body.products[0]).toMatchObject({ sku: "MUG-Blue", offerings: [{ price: 26, quantity: 4 }] });
    expect(body).toMatchObject({ price_on_property: [200], sku_on_property: [200], quantity_on_property: [] });
  });

  it("changes one offering by id, SKUs, quantity and availability", async () => {
    await updateListingInventory(toolDeps(), {
      listing_id: 555,
      changes: [
        { product_id: 2, offering_id: 20, quantity: 0, is_enabled: false },
        { product_id: 2, sku: "NEW" },
      ],
    });
    const body = JSON.parse(etsy.writes()[0]?.body ?? "{}") as { products: unknown[] };
    expect(body.products[1]).toMatchObject({
      sku: "NEW",
      offerings: [{ quantity: 0, is_enabled: false, price: 19.99 }],
    });
    expect(body.products[0]).toMatchObject({ offerings: [{ price: 24.5 }] });
  });

  it("refuses a product that isn't on the listing, writing nothing", async () => {
    const result = await updateListingInventory(toolDeps(), {
      listing_id: 555,
      changes: [{ product_id: 42, price: 1 }],
    });
    expect(resultText(result)).toContain("No product 42");
    expect(etsy.writes()).toHaveLength(0);
  });

  it("refuses an offering that isn't that product's, writing nothing", async () => {
    const result = await updateListingInventory(toolDeps(), {
      listing_id: 555,
      changes: [{ product_id: 1, offering_id: 20, price: 1 }],
    });
    expect(resultText(result)).toContain("Product 1 has no offering 20. Nothing was changed.");
    expect(etsy.writes()).toHaveLength(0);
  });

  it("reports Etsy failures on the read and the write", async () => {
    etsy.routes.set(PUT, () => new Response(null, { status: 400 }));
    expect(
      (await updateListingInventory(toolDeps(), { listing_id: 555, changes: [{ product_id: 1, price: 2 }] })).isError,
    ).toBe(true);
    etsy.routes.set(PUT, () => Response.json({}));
    expect(
      resultJson(await updateListingInventory(toolDeps(), { listing_id: 555, changes: [{ product_id: 1, price: 2 }] })),
    ).toStrictEqual({ updated: true, products: null });
    etsy.routes.set(ROUTE, () => Response.json({ products: "x" }));
    expect(
      resultText(await updateListingInventory(toolDeps(), { listing_id: 555, changes: [{ product_id: 1 }] })),
    ).toContain("unexpected shape");
  });
});

describe("get_listing_inventory", () => {
  it("shows variations, SKUs and decimal prices, without deleted products", async () => {
    const shown = resultJson<{ products: unknown[] }>(await getListingInventory(toolDeps(), { listing_id: 555 }));
    expect(shown.products).toStrictEqual([
      {
        product_id: 1,
        sku: "MUG-Blue",
        variation: "Color: Blue",
        offerings: [{ offering_id: 10, price: 24.5, currency_code: "USD", quantity: 4, is_enabled: true }],
      },
      {
        product_id: 2,
        sku: "MUG-Green",
        variation: "Color: Green",
        offerings: [{ offering_id: 20, price: 19.99, currency_code: "USD", quantity: 4, is_enabled: true }],
      },
    ]);
    etsy.routes.set(ROUTE, () => new Response(null, { status: 404 }));
    expect((await getListingInventory(toolDeps(), { listing_id: 555 })).isError).toBe(true);
  });
});

describe("inventory edge cases", () => {
  const odd = {
    products: [
      {
        product_id: 5,
        sku: null,
        property_values: [{ property_id: 513, property_name: null, scale_id: 4, value_ids: [1], values: ["Large"] }],
        offerings: [
          {
            offering_id: 50,
            quantity: 1,
            is_enabled: true,
            price: { amount: 500, divisor: 100, currency_code: "USD" },
            readiness_state_id: null,
          },
          {
            offering_id: 51,
            quantity: 1,
            is_enabled: true,
            is_deleted: true,
            price: { amount: 1, divisor: 100, currency_code: "USD" },
          },
        ],
      },
    ],
  };

  it("keeps scales, tolerates missing names, SKUs and settings, and skips deleted offerings", async () => {
    etsy.routes.set(ROUTE, () => Response.json(odd));
    expect(
      resultJson<{ products: unknown[] }>(await getListingInventory(toolDeps(), { listing_id: 555 })).products,
    ).toStrictEqual([
      {
        product_id: 5,
        sku: "",
        variation: "?: Large",
        offerings: [{ offering_id: 50, price: 5, currency_code: "USD", quantity: 1, is_enabled: true }],
      },
    ]);
    await updateListingInventory(toolDeps(), { listing_id: 555, changes: [{ product_id: 5, quantity: 2 }] });
    expect(JSON.parse(etsy.writes()[0]?.body ?? "{}")).toStrictEqual({
      products: [
        {
          sku: "",
          property_values: [{ property_id: 513, scale_id: 4, value_ids: [1], values: ["Large"] }],
          offerings: [{ price: 5, quantity: 2, is_enabled: true, readiness_state_id: null }],
        },
      ],
      price_on_property: [],
      quantity_on_property: [],
      sku_on_property: [],
      readiness_state_on_property: [],
    });
  });
});
