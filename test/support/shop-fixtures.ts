// Etsy responses for the shop tool tests (shop 2002, listing 555, order 777).
export const LISTING_ROUTE = "GET /v3/application/listings/555";
export const LISTING_PATCH_ROUTE = "PATCH /v3/application/shops/2002/listings/555";
export const RECEIPT_ROUTE = "GET /v3/application/shops/2002/receipts/777";

export function listing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listing_id: 555,
    shop_id: 2002,
    title: "Blue mug",
    description: "A handmade blue mug.",
    state: "draft",
    quantity: 3,
    price: { amount: 2450, divisor: 100, currency_code: "USD" },
    url: "https://www.etsy.com/listing/555",
    views: 40,
    num_favorers: 5,
    images: [{ listing_image_id: 9, rank: 1, url_570xN: "https://i.etsystatic.com/9.jpg" }],
    ...overrides,
  };
}

export function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receipt_id: 777,
    status: "paid",
    name: "Ada Buyer",
    buyer_email: "ada@example.com",
    first_line: "1 Secret Street",
    second_line: "Apt 2",
    city: "Springfield",
    state: "IL",
    zip: "62701",
    formatted_address: "Ada Buyer\n1 Secret Street\nSpringfield IL 62701",
    country_iso: "US",
    is_paid: true,
    is_shipped: false,
    created_timestamp: 1_762_732_800,
    grandtotal: { amount: 3000, divisor: 100, currency_code: "USD" },
    subtotal: { amount: 2500, divisor: 100, currency_code: "USD" },
    total_shipping_cost: { amount: 400, divisor: 100, currency_code: "USD" },
    total_tax_cost: { amount: 100, divisor: 100, currency_code: "USD" },
    message_from_buyer: "Gift wrap please",
    transactions: [
      {
        transaction_id: 1,
        listing_id: 555,
        title: "Blue mug",
        quantity: 2,
        price: { amount: 1250, divisor: 100, currency_code: "USD" },
      },
    ],
    ...overrides,
  };
}
