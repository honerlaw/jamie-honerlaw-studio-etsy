import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { addListingImage } from "../tools/listings/add-listing-image";
import { attachUploadedPhotos } from "../tools/listings/attach-uploaded-photos";
import { LISTING_ID } from "../tools/listings/listing-fields";
import { requestPhotoUpload } from "../tools/listings/request-photo-upload";
import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { addTool } from "./add-tool";

// Adding photos: the upload link (works everywhere, including phones) and ChatGPT's
// direct file path on the web.
export function registerPhotoTools(server: McpServer, deps: ShopToolDeps): void {
  addTool(server, {
    name: "request_photo_upload",
    title: "Get a photo upload link",
    description:
      "Returns a private link (30 minutes, this listing only) to a page where she picks or takes photos on her " +
      "phone or computer. Use this to add photos to a listing; chat apps can't pass phone photos to tools directly.",
    input: z.object({ listing_id: LISTING_ID }),
    readOnly: false,
    destructive: false,
    run: (args) => requestPhotoUpload(deps, args),
  });
  addTool(server, {
    name: "attach_uploaded_photos",
    title: "Attach uploaded photos",
    description:
      "After she says she has uploaded photos through the link, adds them to the listing in her order. Safe to " +
      "call again if it reports a partial failure: it sends only the photos not yet added.",
    input: z.object({ listing_id: LISTING_ID }),
    readOnly: false,
    destructive: false,
    run: (args) => attachUploadedPhotos(deps, args),
  });
  addTool(server, {
    name: "add_listing_image",
    title: "Add a photo from the chat",
    description:
      "Adds a photo she attached in the chat to a listing. If the app can't pass the photo itself, this returns " +
      "an upload link instead.",
    input: z.object({
      listing_id: LISTING_ID,
      image: z.union([z.looseObject({ download_url: z.string() }), z.string()]).describe("The attached photo."),
    }),
    readOnly: false,
    destructive: false,
    meta: { "openai/fileParams": ["image"] },
    run: (args) => addListingImage(deps, args),
  });
}
