import type { paths } from "../../etsy/generated/schema";
import { moneyToDecimal } from "../../etsy/money-to-decimal";
import type { Inventory, InventoryProduct } from "../../etsy/shapes/inventory";

type InventoryBody = NonNullable<
  paths["/v3/application/listings/{listing_id}/inventory"]["put"]["requestBody"]
>["content"]["application/json"];
type ProductBody = InventoryBody["products"][number];

// One requested change: to a product's SKU, or to its offerings (all of them, or the one
// named by offering_id).
export interface InventoryChange {
  readonly product_id: number;
  readonly offering_id?: number | undefined;
  readonly sku?: string | undefined;
  readonly price?: number | undefined;
  readonly quantity?: number | undefined;
  readonly is_enabled?: boolean | undefined;
}

function writableProduct(product: InventoryProduct, changes: readonly InventoryChange[]): ProductBody {
  const mine = changes.filter((change) => change.product_id === product.product_id);
  const sku = mine.reduce<string>((current, change) => change.sku ?? current, product.sku ?? "");
  return {
    sku,
    property_values: product.property_values.map((value) => ({
      property_id: value.property_id,
      value_ids: value.value_ids,
      values: value.values,
      ...(value.property_name === null || value.property_name === undefined
        ? {}
        : { property_name: value.property_name }),
      ...(value.scale_id === null || value.scale_id === undefined ? {} : { scale_id: value.scale_id }),
    })),
    offerings: product.offerings
      .filter((offering) => offering.is_deleted !== true)
      .map((offering) => {
        const applied = mine.filter(
          (change) => change.offering_id === undefined || change.offering_id === offering.offering_id,
        );
        const pick = <K extends "price" | "quantity" | "is_enabled">(key: K, read: NonNullable<InventoryChange[K]>) =>
          applied.reduce<NonNullable<InventoryChange[K]>>((current, change) => change[key] ?? current, read);
        return {
          price: pick("price", moneyToDecimal(offering.price)),
          quantity: pick("quantity", offering.quantity),
          is_enabled: pick("is_enabled", offering.is_enabled),
          readiness_state_id: offering.readiness_state_id ?? null,
        };
      }),
  };
}

// The body for updateListingInventory: the inventory just read, with only `changes`
// applied. Etsy replaces the whole inventory on every write, so every product and
// offering not named goes back exactly as it was read (prices as decimals, the form
// Etsy takes on writes), and the *_on_property settings are kept.
export function writableInventory(inventory: Inventory, changes: readonly InventoryChange[]): InventoryBody {
  return {
    products: inventory.products
      .filter((product) => product.is_deleted !== true)
      .map((product) => writableProduct(product, changes)),
    price_on_property: inventory.price_on_property ?? [],
    quantity_on_property: inventory.quantity_on_property ?? [],
    sku_on_property: inventory.sku_on_property ?? [],
    readiness_state_on_property: inventory.readiness_state_on_property ?? [],
  };
}
