// The Etsy operations each v1 tool (and the sign-in itself) calls. The OAuth scopes the
// server requests are derived from this table: tests/etsy-scopes.test.ts checks that the
// union of these operations' `security` scopes in etsy/openapi.json equals ETSY_SCOPES,
// so a tool that needs a new scope fails CI instead of failing at runtime.
//
// The table lists every tool planned for v1 (most ship in Phase 3) so that she grants
// the full set once, at her first sign-in, and never has to reconnect for new tools.
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  sign_in: ["getMe"],
  get_shop_overview: ["getShop"],
  list_shop_sections: ["getShopSections"],
  list_shipping_profiles: ["getShopShippingProfiles"],
  list_processing_profiles: ["getShopReadinessStateDefinitions"],
  list_return_policies: ["getShopReturnPolicies"],
  search_categories: ["getSellerTaxonomyNodes"],
  list_listings: ["getListingsByShop"],
  get_listing: ["getListing", "getListingImages"],
  create_draft_listing: ["createDraftListing"],
  update_listing: ["updateListing"],
  request_photo_upload: ["getListing"],
  attach_uploaded_photos: ["uploadListingImage"],
  add_listing_image: ["uploadListingImage"],
  remove_listing_image: ["deleteListingImage"],
  publish_listing: ["getListing", "updateListing"],
  renew_listing: ["getListing", "updateListing"],
  deactivate_listing: ["getListing", "updateListing"],
  delete_listing: ["getListing", "deleteListing"],
  get_listing_inventory: ["getListingInventory"],
  update_listing_inventory: ["getListingInventory", "updateListingInventory"],
  list_orders: ["getShopReceipts"],
  get_order: ["getShopReceipt"],
  mark_order_shipped: ["getShopReceipt", "createReceiptShipment"],
  get_sales_summary: ["getShopReceipts"],
  get_listing_stats: ["getListing"],
  list_reviews: ["getReviewsByShop"],
  get_views_trend: [],
  daily_views_snapshot: ["getListingsByShop"],
};

export const ETSY_SCOPES: readonly string[] = [
  "listings_d",
  "listings_r",
  "listings_w",
  "shops_r",
  "transactions_r",
  "transactions_w",
];
