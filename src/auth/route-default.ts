import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { handleHealth } from "../routes/handle-health";
import { handleAuthorize } from "./handle-authorize";
import { handleCallback } from "./handle-callback";

// Everything the OAuth provider doesn't serve itself (it owns discovery, /token and
// /mcp): health, the start of sign-in and Etsy's redirect back.
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
  return new Response("Not Found", { status: 404 });
}
