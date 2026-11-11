import { z } from "zod";

// An inventory as Etsy returns it. Everything a write needs is kept, because untouched
// products go back unchanged on every write.
const INVENTORY_OFFERING = z.object({
  offering_id: z.number(),
  quantity: z.number(),
  is_enabled: z.boolean(),
  is_deleted: z.boolean().nullish(),
  price: z.object({ amount: z.number(), divisor: z.number().positive(), currency_code: z.string() }),
  readiness_state_id: z.number().nullish(),
});

const INVENTORY_PRODUCT = z.object({
  product_id: z.number(),
  sku: z.string().nullish(),
  is_deleted: z.boolean().nullish(),
  offerings: z.array(INVENTORY_OFFERING),
  property_values: z.array(
    z.object({
      property_id: z.number(),
      property_name: z.string().nullish(),
      scale_id: z.number().nullish(),
      value_ids: z.array(z.number()),
      values: z.array(z.string()),
    }),
  ),
});

export const INVENTORY = z.object({
  products: z.array(INVENTORY_PRODUCT),
  price_on_property: z.array(z.number()).nullish(),
  quantity_on_property: z.array(z.number()).nullish(),
  sku_on_property: z.array(z.number()).nullish(),
  readiness_state_on_property: z.array(z.number()).nullish(),
});

export type Inventory = z.output<typeof INVENTORY>;
export type InventoryProduct = z.output<typeof INVENTORY_PRODUCT>;
