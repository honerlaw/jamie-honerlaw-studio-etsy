import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { describeEtsyStatus } from "../../etsy/describe-etsy-status";
import { inspectImage } from "../../uploads/inspect-image";
import { UPLOAD_LIMITS, uploadSessionKey } from "../../uploads/upload-limits";
import { UPLOAD_SESSION, type UploadSession } from "../../uploads/upload-session";
import { uploadToEtsy } from "../../uploads/upload-to-etsy";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";

// Sends the photos she staged through the upload link to Etsy, in her order. It holds
// an exclusive lease on the session, so a second attach running at the same time is
// refused. Each photo is recorded as soon as Etsy has it, so a retry after a failure
// sends only the rest. When all are through, the session is used up.
export async function attachUploadedPhotos(
  deps: ShopToolDeps,
  args: { readonly listing_id: number },
): Promise<CallToolResult> {
  const key = uploadSessionKey(args.listing_id);
  const claimed = await deps.store.claim(key, UPLOAD_LIMITS.attachLeaseMs);
  if (claimed === null) {
    return toolText(
      "No open upload for this listing (the link expired, was already attached, or another attach is running). " +
        "Use request_photo_upload for a new link.",
      true,
    );
  }
  const session: UploadSession = UPLOAD_SESSION.parse(JSON.parse(claimed));
  const result = await withAccessToken(deps, async (token) => attachAll(deps, args.listing_id, session, token));
  if (result.isError === true) {
    await deps.store.release(key);
  }
  return result;
}

async function attachAll(
  deps: ShopToolDeps,
  listingId: number,
  session: UploadSession,
  token: string,
): Promise<CallToolResult> {
  const key = uploadSessionKey(listingId);
  const staged = (await deps.uploads.list({ prefix: `uploads/${session.nonce}/` })).objects
    .map((object) => object.key)
    .sort();
  if (staged.length === 0 && Object.keys(session.uploaded).length === 0) {
    return toolText("No photos have been uploaded through the link yet.", true);
  }
  const uploaded = { ...session.uploaded };
  for (const object of staged) {
    const body = await deps.uploads.get(object);
    const bytes = body === null ? null : new Uint8Array(await body.arrayBuffer());
    const image = bytes === null ? null : inspectImage(bytes);
    if (bytes !== null && image !== null) {
      const sent = await uploadToEtsy(
        deps.etsy(token),
        { shopId: deps.shopId, listingId },
        { bytes, type: image.type },
      );
      if (!sent.ok) {
        return toolText(
          `${describeEtsyStatus(sent.response.status)} ${String(Object.keys(uploaded).length)} of ` +
            `${String(staged.length + Object.keys(session.uploaded).length)} photos are on the listing. ` +
            "Call attach_uploaded_photos again to send the rest (no photo is sent twice).",
          true,
        );
      }
      uploaded[object] = sent.imageId;
      await deps.store.update(key, JSON.stringify({ nonce: session.nonce, uploaded }));
    }
    await deps.uploads.delete(object);
  }
  await deps.store.consume(key);
  return toolText({ attached: Object.keys(uploaded).length, listing_image_ids: Object.values(uploaded) });
}
