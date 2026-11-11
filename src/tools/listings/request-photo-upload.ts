import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { startUploadSession } from "../../uploads/start-upload-session";
import { UPLOAD_LIMITS } from "../../uploads/upload-limits";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

// A private link to a page where she picks photos from her camera roll (or takes them).
// Chat apps can't reliably pass phone photos to a tool, so this is the dependable path.
export async function requestPhotoUpload(
  deps: ShopToolDeps,
  args: { readonly listing_id: number },
  now: number = Date.now(),
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const read = await readListing(deps.etsy(token), deps.shopId, args.listing_id);
    if (!read.ok) {
      return read.result;
    }
    const link = await startUploadSession(deps, { shopId: deps.shopId, listingId: args.listing_id }, now);
    return toolText({
      upload_link: link.url,
      expires_at: link.expiresAt,
      instructions:
        `Give her this link. She opens it, picks up to ${String(UPLOAD_LIMITS.maxImages)} photos, puts them in order ` +
        `and taps Upload. When she says she's done, call attach_uploaded_photos for listing ${String(args.listing_id)}. ` +
        "The link works for 30 minutes and only for this listing; don't share it elsewhere.",
    });
  });
}
