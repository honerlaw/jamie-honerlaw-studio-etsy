import { z } from "zod";

import type { EtsyClient } from "../etsy/create-etsy-client";

const UPLOADED = z.object({ listing_image_id: z.number() });

// Sends one image to Etsy's uploadListingImage as multipart form data, at `rank` (1 is
// the main photo). The rank is always sent: Etsy's default is 1, which would put every
// new photo first. Returns the new image id, or the failed response.
export async function uploadToEtsy(
  etsy: EtsyClient,
  target: { readonly shopId: string; readonly listingId: number },
  image: { readonly bytes: Uint8Array; readonly type: "jpeg" | "png"; readonly rank: number },
): Promise<{ readonly ok: true; readonly imageId: number } | { readonly ok: false; readonly response: Response }> {
  const form = new FormData();
  form.set(
    "image",
    new File([image.bytes], `photo.${image.type === "png" ? "png" : "jpg"}`, { type: `image/${image.type}` }),
  );
  form.set("rank", String(image.rank));
  const { data, response } = await etsy.POST("/v3/application/shops/{shop_id}/listings/{listing_id}/images", {
    params: { path: { shop_id: Number(target.shopId), listing_id: target.listingId } },
    body: {},
    bodySerializer: () => form,
  });
  if (!response.ok) {
    return { ok: false, response };
  }
  const uploaded = UPLOADED.safeParse(data);
  return uploaded.success
    ? { ok: true, imageId: uploaded.data.listing_image_id }
    : { ok: false, response: new Response(null, { status: 502 }) };
}
