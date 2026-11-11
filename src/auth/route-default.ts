import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { handleHealth } from "../routes/handle-health";
import { handleUploadImage } from "../uploads/handle-upload-image";
import { handleUploadPage } from "../uploads/handle-upload-page";
import { handleAuthorize } from "./handle-authorize";
import { handleCallback } from "./handle-callback";

// Everything the OAuth provider doesn't serve itself (it owns discovery, /token and
// /mcp): health, the start of sign-in, Etsy's redirect back, and the photo upload page.
export async function routeDefault(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health" && request.method === "GET") {
    return handleHealth();
  }
  if (pathname === "/authorize") {
    return handleAuthorize(request, env, oauth);
  }
  if (pathname === "/callback" && request.method === "GET") {
    return handleCallback(request, env, oauth);
  }
  if (pathname === "/upload" && request.method === "GET") {
    return handleUploadPage();
  }
  if (pathname === "/upload/image" && request.method === "POST") {
    return handleUploadImage(request, env);
  }
  return new Response("Not Found", { status: 404 });
}
