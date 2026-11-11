import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { describeEtsyStatus } from "../../etsy/describe-etsy-status";
import { inspectImage } from "../../uploads/inspect-image";
import { UPLOAD_LIMITS, uploadSessionKey } from "../../uploads/upload-limits";
import { UPLOAD_SESSION, type UploadSession } from "../../uploads/upload-session";
import { uploadToEtsy } from "../../uploads/upload-to-etsy";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

// Sends the photos she staged through the upload link to Etsy, in her order, after the
// listing's existing photos. It holds an exclusive lease on the session, so a second
// attach running at the same time is refused, and a session replaced mid-way (a new
// link) is never overwritten. Each photo is recorded as soon as Etsy has it and skipped
// from then on, so a retry after a failure sends only the rest. When all are through,
// the session is used up.
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
  const session: UploadSession = UPLOAD_SESSION.parse(JSON.parse(claimed.value));
  const lease = { key, id: claimed.lease };
  const result = await withAccessToken(deps, async (token) =>
    attachAll(deps, { listingId: args.listing_id, session, lease }, token),
  );
  if (result.isError === true) {
    await deps.store.release(key, claimed.lease);
  }
  return result;
}

interface Attach {
  readonly listingId: number;
  readonly session: UploadSession;
  readonly lease: { readonly key: string; readonly id: string };
}

function progress(done: number, total: number): string {
  return `${String(done)} of ${String(total)} photos are on the listing.`;
}

async function attachAll(deps: ShopToolDeps, attach: Attach, token: string): Promise<CallToolResult> {
  const { listingId, session, lease } = attach;
  const etsy = deps.etsy(token);
  const read = await readListing(etsy, deps.shopId, listingId);
  if (!read.ok) {
    return read.result;
  }
  const staged = (await deps.uploads.list({ prefix: `uploads/${session.nonce}/` })).objects
    .map((object) => object.key)
    .sort();
  const uploaded = { ...session.uploaded };
  const total = new Set([...staged, ...Object.keys(uploaded)]).size;
  if (total === 0) {
    return toolText("No photos have been uploaded through the link yet.", true);
  }
  let rank = (read.listing.images ?? []).length + 1;
  for (const object of staged) {
    const body = object in uploaded ? null : await deps.uploads.get(object);
    const bytes = body === null ? null : new Uint8Array(await body.arrayBuffer());
    const image = bytes === null ? null : inspectImage(bytes);
    if (bytes !== null && image !== null) {
      const sent = await uploadToEtsy(etsy, { shopId: deps.shopId, listingId }, { bytes, type: image.type, rank });
      if (!sent.ok) {
        return toolText(
          `${describeEtsyStatus(sent.response.status)} ${progress(Object.keys(uploaded).length, total)} ` +
            "Call attach_uploaded_photos again to send the rest (no photo is sent twice).",
          true,
        );
      }
      rank += 1;
      uploaded[object] = sent.imageId;
      if (!(await deps.store.update(lease.key, lease.id, JSON.stringify({ nonce: session.nonce, uploaded })))) {
        return toolText(
          `A new upload link replaced this one mid-way. ${progress(Object.keys(uploaded).length, total)}`,
          true,
        );
      }
    }
    await deps.uploads.delete(object);
  }
  await deps.store.finish(lease.key, lease.id);
  return toolText({ attached: Object.keys(uploaded).length, listing_image_ids: Object.values(uploaded) });
}
