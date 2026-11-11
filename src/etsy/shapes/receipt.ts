import { z } from "zod";

import { MONEY } from "./money";
import { TIMESTAMP } from "./timestamp";

// Receipt (order) shapes. These are allowlists: zod drops every key they don't name,
// which is how buyer email and street address stay out of the chat. Only ADDRESS
// carries the address, and only get_order with include_address uses it.
const ORDER_ITEM = z.object({
  transaction_id: z.number(),
  listing_id: z.number().nullish(),
  title: z.string().nullish(),
  quantity: z.number(),
  sku: z.string().nullish(),
  price: MONEY.nullish(),
  expected_ship_date: TIMESTAMP.nullish(),
  variations: z.array(z.object({ formatted_name: z.string(), formatted_value: z.string() })).nullish(),
});

export const ORDER_SUMMARY = z.object({
  receipt_id: z.number(),
  status: z.string(),
  name: z.string().nullish(),
  country_iso: z.string().nullish(),
  is_paid: z.boolean(),
  is_shipped: z.boolean(),
  created_timestamp: TIMESTAMP,
  grandtotal: MONEY.nullish(),
  transactions: z.array(ORDER_ITEM),
});

export const ORDER_DETAIL = ORDER_SUMMARY.extend({
  message_from_buyer: z.string().nullish(),
  is_gift: z.boolean().nullish(),
  gift_message: z.string().nullish(),
  subtotal: MONEY.nullish(),
  total_shipping_cost: MONEY.nullish(),
  total_tax_cost: MONEY.nullish(),
  discount_amt: MONEY.nullish(),
  shipments: z
    .array(
      z.object({
        carrier_name: z.string(),
        tracking_code: z.string(),
        shipment_notification_timestamp: TIMESTAMP.nullish(),
      }),
    )
    .nullish(),
});

export const ADDRESS = z.object({
  name: z.string().nullish(),
  first_line: z.string().nullish(),
  second_line: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zip: z.string().nullish(),
  country_iso: z.string().nullish(),
});

// What a receipt list page is, for the multi-page tools.
export const RECEIPT_PAGE = z.object({ count: z.number(), results: z.array(z.unknown()) });
