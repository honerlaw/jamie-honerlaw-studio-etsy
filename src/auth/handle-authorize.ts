import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { authorizationFailure } from "./authorization-failure";
import { beginEtsySignIn } from "./begin-etsy-sign-in";

// GET /authorize from one of her pre-registered apps: the provider validates the request
// (client, exact redirect URI, PKCE), then she goes straight to Etsy's sign-in. There is
// no consent page: every client is one she put on the MCP_CLIENTS list herself, and the
// Etsy allowlist still decides whose account may finish.
export async function handleAuthorize(
  request: Request,
  env: Pick<Env, "ONE_TIME_STORE" | "ETSY_KEYSTRING">,
  oauth: OAuthHelpers,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
  }
  try {
    const authRequest = await oauth.parseAuthRequest(request);
    return await beginEtsySignIn(authRequest, env, new URL(request.url).origin);
  } catch (error) {
    return authorizationFailure(error);
  }
}
