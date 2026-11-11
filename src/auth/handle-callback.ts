import { authorizationErrorRedirect, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";

import { createEtsyClient } from "../etsy/create-etsy-client";
import { etsyApiKey } from "../etsy/etsy-api-key";
import { fetchEtsyMe } from "../etsy/fetch-etsy-me";
import { requestEtsyToken } from "../etsy/request-etsy-token";
import { sleep } from "../etsy/sleep";
import { logEvent } from "../log/log-event";
import { escapeHtml } from "../pages/escape-html";
import { htmlPage } from "../pages/html-page";
import { STATE_COOKIE } from "./begin-etsy-sign-in";
import { oneTimeStoreStub } from "./one-time-store-stub";
import { readCookie } from "./read-cookie";

const STORED = z.object({
  verifier: z.string().min(1),
  request: z.custom<AuthRequest>((value) => typeof value === "object" && value !== null),
});

function failure(status: number, message: string, headers: Headers): Response {
  return htmlPage(status, "Etsy sign-in", `<p>${message}</p><p>Close this tab and connect again.</p>`, headers);
}

// Etsy redirects here after she signs in. The state must match this browser's cookie and
// is consumed atomically (single use). Then the code is exchanged and getMe decides:
// only the allowlisted user and shop get a grant. Everyone else gets a 403, no grant and
// no stored tokens. Bootstrap mode only shows the ids, so she can fill in the allowlist.
export async function handleCallback(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers({
    "set-cookie": `${STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
  });
  const state = url.searchParams.get("state") ?? "";
  const stored =
    state.length > 0 && readCookie(request, STATE_COOKIE) === state
      ? await oneTimeStoreStub(env).consume(`etsy-state:${state}`)
      : null;
  if (stored === null) {
    return failure(400, "This sign-in link has expired, was already used, or was opened in another browser.", headers);
  }
  const { request: authRequest, verifier } = STORED.parse(JSON.parse(stored));
  if (url.searchParams.has("error")) {
    headers.set("location", authorizationErrorRedirect(authRequest, "access_denied"));
    return new Response(null, { status: 302, headers });
  }

  const apiKey = etsyApiKey(env);
  const exchanged = await requestEtsyToken((input, init) => fetch(input, init), apiKey, {
    grant_type: "authorization_code",
    client_id: env.ETSY_KEYSTRING,
    redirect_uri: `${url.origin}/callback`,
    code: url.searchParams.get("code") ?? "",
    code_verifier: verifier,
  });
  if (exchanged.kind !== "ok") {
    logEvent("etsy_code_exchange_failed", { outcome: exchanged.kind });
    return failure(502, "Etsy didn't complete the sign-in.", headers);
  }
  const me = await fetchEtsyMe(
    createEtsyClient({ apiKey, accessToken: exchanged.tokens.accessToken, fetch: (r) => fetch(r), sleep }),
  );
  if (me === null) {
    logEvent("etsy_get_me_failed");
    return failure(502, "Etsy didn't say which account signed in.", headers);
  }

  if (env.ALLOWLIST_BOOTSTRAP === "true") {
    return htmlPage(
      200,
      "Your Etsy ids",
      `<p>Etsy user id: <code>${escapeHtml(me.userId)}</code></p>` +
        `<p>Etsy shop id: <code>${escapeHtml(me.shopId)}</code></p>` +
        `<p>Set these as ALLOWED_ETSY_USER_ID and ALLOWED_ETSY_SHOP_ID, then turn ALLOWLIST_BOOTSTRAP off. ` +
        `Nothing was connected.</p>`,
      headers,
    );
  }
  const allowedUser = env.ALLOWED_ETSY_USER_ID.trim();
  const allowedShop = env.ALLOWED_ETSY_SHOP_ID.trim();
  if (allowedUser.length === 0 || allowedShop.length === 0 || me.userId !== allowedUser || me.shopId !== allowedShop) {
    logEvent("allowlist_rejected", {
      reason: allowedUser.length === 0 || allowedShop.length === 0 ? "unset" : "mismatch",
    });
    return failure(403, "This Etsy account isn't allowed to use this server.", headers);
  }

  try {
    await env.ETSY_TOKEN_VAULT.getByName(allowedShop).store(exchanged.tokens);
  } catch {
    // Never echo the error: a bad TOKEN_ENC_KEYS secret is the likely cause.
    logEvent("vault_store_failed");
    return failure(500, "The server couldn't save the Etsy connection (check its secrets).", headers);
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: me.userId,
    metadata: {},
    scope: authRequest.scope,
    props: { etsyUserId: me.userId, shopId: me.shopId },
  });
  headers.set("location", redirectTo);
  return new Response(null, { status: 302, headers });
}
