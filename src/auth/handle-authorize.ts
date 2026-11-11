import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { escapeHtml } from "../pages/escape-html";
import { htmlPage } from "../pages/html-page";
import { authorizationFailure } from "./authorization-failure";
import { beginEtsySignIn } from "./begin-etsy-sign-in";

// GET shows which app is asking and where its access will go; POST approves (and moves
// on to Etsy's own sign-in) or declines. The consent helpers bind the form to this
// browser and forbid framing, so another site can't approve on her behalf.
export async function handleAuthorize(
  request: Request,
  env: Pick<Env, "ONE_TIME_STORE" | "ETSY_KEYSTRING">,
  oauth: OAuthHelpers,
): Promise<Response> {
  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      const body =
        `<h1>Connect ${escapeHtml(details.clientName)} to your Etsy shop?</h1>` +
        `<p>Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>. ` +
        `This app registered itself, so its name is not verified: continue only if you just ` +
        `started connecting from it.</p>` +
        `<form method="post"><input type="hidden" name="handle" value="${escapeHtml(consent.handle)}">` +
        `<button name="decision" value="approve">Continue to Etsy</button> ` +
        `<button name="decision" value="deny">Cancel</button></form>`;
      return htmlPage(200, "Connect your Etsy shop", body, consent.headers);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = form.get("handle");
      const handleText = typeof handle === "string" ? handle : "";
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handleText);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handleText);
      return await beginEtsySignIn(approved.request, approved.headers, env, new URL(request.url).origin);
    }
  } catch (error) {
    return authorizationFailure(error);
  }
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
}
