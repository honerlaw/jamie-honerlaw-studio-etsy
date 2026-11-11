import { getOAuthApi, OAuthProvider, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";

import { handleMcp } from "../mcp/handle-mcp";
import { allowedRedirectUris } from "./allowed-redirect-uris";
import { checkClientRegistration } from "./check-client-registration";
import { routeDefault } from "./route-default";

// The OAuth 2.1 authorization server (PKCE S256, discovery, dynamic registration,
// token issuance and validation) in front of /mcp. Built per request because the
// resource URL is this Worker's own origin and the redirect allowlist comes from env.
export function buildProvider(env: Env, origin: string): OAuthProvider<Env> {
  const allowed = allowedRedirectUris(env.ALLOWED_REDIRECT_URIS);
  const options: OAuthProviderOptions<Env> = {
    apiRoute: "/mcp",
    apiHandler: {
      fetch: (request, handlerEnv, ctx) => handleMcp(request, handlerEnv, ctx, getOAuthApi(options, handlerEnv)),
    },
    defaultHandler: {
      fetch: (request, handlerEnv) => routeDefault(request, handlerEnv, getOAuthApi(options, handlerEnv)),
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    clientRegistrationCallback: ({ clientMetadata }) => checkClientRegistration(clientMetadata, allowed),
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      resource_name: "Etsy shop",
    },
  };
  return new OAuthProvider<Env>(options);
}
