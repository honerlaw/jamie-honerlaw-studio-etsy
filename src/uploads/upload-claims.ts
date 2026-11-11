import { z } from "zod";

// What an upload token vouches for: this shop, this listing, this session, until `exp`
// (epoch ms).
export const UPLOAD_CLAIMS = z.object({
  shopId: z.string(),
  listingId: z.number(),
  nonce: z.string(),
  exp: z.number(),
});

export type UploadClaims = z.output<typeof UPLOAD_CLAIMS>;
