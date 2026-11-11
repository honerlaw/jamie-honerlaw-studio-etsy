import { z } from "zod";

import { MONEY } from "./money";
import { TIMESTAMP } from "./timestamp";

// The listing fields a list shows. Unknown keys are dropped by zod.
export const LISTING_SUMMARY = z.object({
  listing_id: z.number(),
  title: z.string(),
  state: z.string(),
  quantity: z.number(),
  price: MONEY.nullish(),
  url: z.string().nullish(),
  views: z.number().nullish(),
  num_favorers: z.number().nullish(),
  ending_timestamp: TIMESTAMP.nullish(),
});

const IMAGE = z.object({
  listing_image_id: z.number(),
  rank: z.number(),
  url_570xN: z.string(),
  alt_text: z.string().nullish(),
});

// One listing in full: what she can edit, plus its photos.
export const LISTING_DETAIL = LISTING_SUMMARY.extend({
  description: z.string(),
  tags: z.array(z.string()).nullish(),
  materials: z.array(z.string()).nullish(),
  taxonomy_id: z.number().nullish(),
  shop_section_id: z.number().nullish(),
  shipping_profile_id: z.number().nullish(),
  return_policy_id: z.number().nullish(),
  readiness_state_id: z.number().nullish(),
  who_made: z.string().nullish(),
  when_made: z.string().nullish(),
  is_supply: z.boolean().nullish(),
  should_auto_renew: z.boolean().nullish(),
  has_variations: z.boolean().nullish(),
  created_timestamp: TIMESTAMP.nullish(),
  last_modified_timestamp: TIMESTAMP.nullish(),
  images: z.array(IMAGE).nullish(),
});

export const LISTING_PAGE = z.object({ count: z.number(), results: z.array(LISTING_SUMMARY) });
