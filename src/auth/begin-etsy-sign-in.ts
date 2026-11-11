import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import { base64url } from "../vault/base64url";
import { ETSY_SCOPES } from "./etsy-scopes";
import { oneTimeStoreStub } from "./one-time-store-stub";

export const STATE_COOKIE = "__Host-etsy-oauth-state";
const STATE_TTL_SECONDS = 600;

// Once the provider has validated an authorization request from one of her apps: creates
// the Etsy `state` and PKCE verifier, stores them with the request in the OneTimeStore
// (single use, ten minutes), binds the state to this browser with a cookie, and
// redirects to Etsy's consent screen.
export async function beginEtsySignIn(
  approved: AuthRequest,
  env: Pick<Env, "ONE_TIME_STORE" | "ETSY_KEYSTRING">,
  origin: string,
): Promise<Response> {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  await oneTimeStoreStub(env).put(
    `etsy-state:${state}`,
    JSON.stringify({ request: approved, verifier }),
    STATE_TTL_SECONDS * 1000,
  );
  const etsy = new URL("https://www.etsy.com/oauth/connect");
  etsy.search = new URLSearchParams({
    response_type: "code",
    client_id: env.ETSY_KEYSTRING,
    redirect_uri: `${origin}/callback`,
    scope: ETSY_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const headers = new Headers();
  headers.append(
    "set-cookie",
    `${STATE_COOKIE}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${String(STATE_TTL_SECONDS)}`,
  );
  headers.set("location", etsy.toString());
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}
