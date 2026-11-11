import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";

import { escapeHtml } from "../pages/escape-html";
import { htmlPage } from "../pages/html-page";

// Maps a consent-helper failure to a response, per the library's guidance: redirect to
// the client only when the library has validated where to; otherwise render locally.
// Anything else is a bug or an outage and is rethrown (a 500).
export function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
    return Response.redirect(error.redirectTo, 302);
  }
  if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
    const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
    return htmlPage(
      400,
      "Sign-in problem",
      `<p>${escapeHtml(message)}</p><p>Close this tab and start connecting again.</p>`,
    );
  }
  throw error;
}
