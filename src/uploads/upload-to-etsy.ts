import { z } from "zod";

import type { EtsyClient } from "../etsy/create-etsy-client";

const UPLOADED = z.object({ listing_image_id: z.number() });

// Sends one image to Etsy's uploadListingImage as multipart form data. Without a rank,
// Etsy appends it after the listing's existing photos, so callers upload in order.
// Returns the new image id, or the failed response.
export async function uploadToEtsy(
  etsy: EtsyClient,
  target: { readonly shopId: string; readonly listingId: number },
  image: { readonly bytes: Uint8Array; readonly type: "jpeg" | "png" },
): Promise<{ readonly ok: true; readonly imageId: number } | { readonly ok: false; readonly response: Response }> {
  const form = new FormData();
  form.set(
    "image",
    new File([image.bytes], `photo.${image.type === "png" ? "png" : "jpg"}`, { type: `image/${image.type}` }),
  );
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
