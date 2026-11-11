import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { inspectImage } from "../../uploads/inspect-image";
import { startUploadSession } from "../../uploads/start-upload-session";
import { UPLOAD_LIMITS } from "../../uploads/upload-limits";
import { uploadToEtsy } from "../../uploads/upload-to-etsy";
import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";
import { readListing } from "./read-listing";

// ChatGPT's file param: on the web a real file, on its phone apps a placeholder string.
export type ImageParam = { readonly download_url: string } | string;

async function download(deps: ShopToolDeps, url: string): Promise<Uint8Array | string> {
  if (!url.startsWith("https://")) {
    return "The photo link must be https.";
  }
  const response = await deps.fetchFile(url);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!response.ok || declared > UPLOAD_LIMITS.maxBytes) {
    return response.ok ? "That photo is larger than 10 MB." : "The photo couldn't be downloaded.";
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > UPLOAD_LIMITS.maxBytes ? "That photo is larger than 10 MB." : bytes;
}

// The fast path for a photo attached in ChatGPT on the web: it's downloaded and sent to
// Etsy straight away. Anything else (a phone placeholder) gets an upload link instead.
export async function addListingImage(
  deps: ShopToolDeps,
  args: { readonly listing_id: number; readonly image: ImageParam },
  now: number = Date.now(),
): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const etsy = deps.etsy(token);
    const read = await readListing(etsy, deps.shopId, args.listing_id);
    if (!read.ok) {
      return read.result;
    }
    if (typeof args.image === "string") {
      const link = await startUploadSession(deps, { shopId: deps.shopId, listingId: args.listing_id }, now);
      return toolText({
        message: "This app didn't pass the photo itself. Give her this link to upload it instead.",
        upload_link: link.url,
        expires_at: link.expiresAt,
        next_step: `Call attach_uploaded_photos for listing ${String(args.listing_id)} when she's done.`,
      });
    }
    const bytes = await download(deps, args.image.download_url);
    if (typeof bytes === "string") {
      return toolText(bytes, true);
    }
    const image = inspectImage(bytes);
    if (image === null || image.width > UPLOAD_LIMITS.maxSidePx || image.height > UPLOAD_LIMITS.maxSidePx) {
      return toolText("That file isn't a JPEG or PNG photo up to 6000 px a side.", true);
    }
    const sent = await uploadToEtsy(
      etsy,
      { shopId: deps.shopId, listingId: args.listing_id },
      { bytes, type: image.type },
    );
    return sent.ok ? toolText({ added: sent.imageId }) : etsyError(sent.response);
  });
}
