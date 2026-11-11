import { z } from "zod";

// A listing's upload session: the nonce that names its R2 prefix (uploads/<nonce>/) and
// the staged images already sent to Etsy (R2 key → Etsy listing_image_id), so a retried
// attach never uploads one twice.
export const UPLOAD_SESSION = z.object({
  nonce: z.string(),
  uploaded: z.record(z.string(), z.number()),
});

export type UploadSession = z.output<typeof UPLOAD_SESSION>;
