import { moneyToDecimal } from "../../etsy/money-to-decimal";
import type { Inventory } from "../../etsy/shapes/inventory";

// The inventory as the model sees it: each product's variation ("Color: Red"), SKU and
// offerings with decimal prices.
export function describeInventory(inventory: Inventory): unknown {
  return inventory.products
    .filter((product) => product.is_deleted !== true)
    .map((product) => ({
      product_id: product.product_id,
      sku: product.sku ?? "",
      variation: product.property_values
        .map((value) => `${value.property_name ?? "?"}: ${value.values.join(", ")}`)
        .join("; "),
      offerings: product.offerings
        .filter((offering) => offering.is_deleted !== true)
        .map((offering) => ({
          offering_id: offering.offering_id,
          price: moneyToDecimal(offering.price),
          currency_code: offering.price.currency_code,
          quantity: offering.quantity,
          is_enabled: offering.is_enabled,
        })),
    }));
}
