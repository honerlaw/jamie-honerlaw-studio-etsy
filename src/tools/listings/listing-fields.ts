import { z } from "zod";

// Editable listing fields shared by create_draft_listing and update_listing, with the
// limits Etsy documents (13 tags of up to 20 characters; letters, digits and spaces).
export const WHO_MADE = z.enum(["i_did", "someone_else", "collective"]);
export const WHEN_MADE = z.enum([
  "made_to_order",
  "2020_2026",
  "2010_2019",
  "2007_2009",
  "before_2007",
  "2000_2006",
  "1990s",
  "1980s",
  "1970s",
  "1960s",
  "1950s",
  "1940s",
  "1930s",
  "1920s",
  "1910s",
  "1900s",
  "1800s",
  "1700s",
  "before_1700",
]);
export const TAGS = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[\p{L}\p{N}\s\-'™©®]+$/u),
  )
  .max(13)
  .describe("Up to 13 search tags, each up to 20 characters.");
export const MATERIALS = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .regex(/^[\p{L}\p{N}\s]+$/u),
  )
  .max(13);
export const LISTING_ID = z.number().int().positive().describe("The listing's id (listing_id).");

export const OPTIONAL_LISTING_FIELDS = {
  description: z.string().min(1).optional(),
  tags: TAGS.optional(),
  materials: MATERIALS.optional(),
  taxonomy_id: z.number().int().positive().optional().describe("A category id from search_categories."),
  shop_section_id: z.number().int().positive().optional(),
  shipping_profile_id: z.number().int().positive().optional(),
  return_policy_id: z.number().int().positive().optional(),
  readiness_state_id: z.number().int().positive().optional().describe("A processing profile id."),
  who_made: WHO_MADE.optional(),
  when_made: WHEN_MADE.optional(),
  is_supply: z.boolean().optional(),
};
