import type { ClientRegistrationCallbackResult } from "@cloudflare/workers-oauth-provider";

// Accepts a dynamic client registration only when it names at least one redirect URI
// and every one is on the allowlist (exact match). Anything else gets a 400.
export function checkClientRegistration(
  metadata: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): ClientRegistrationCallbackResult | undefined {
  const uris: unknown = metadata["redirect_uris"];
  const ok =
    Array.isArray(uris) && uris.length > 0 && uris.every((uri) => typeof uri === "string" && allowed.includes(uri));
  return ok ? undefined : { description: "redirect_uris must be the documented callbacks of a supported MCP client" };
}
