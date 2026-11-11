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
  if (!response.ok || response.body === null) {
    return "The photo couldn't be downloaded.";
  }
  if (Number(response.headers.get("content-length") ?? "0") > UPLOAD_LIMITS.maxBytes) {
    await response.body.cancel();
    return "That photo is larger than 10 MB.";
  }
  // Read as a stream and stop past 10 MB, so a huge or unsized body can't fill memory.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) {
      await reader.cancel();
      return "The photo couldn't be downloaded.";
    }
    size += chunk.length;
    if (size > UPLOAD_LIMITS.maxBytes) {
      await reader.cancel();
      return "That photo is larger than 10 MB.";
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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
      // After her existing photos.
      { bytes, type: image.type, rank: (read.listing.images ?? []).length + 1 },
    );
    return sent.ok ? toolText({ added: sent.imageId }) : etsyError(sent.response);
  });
}
