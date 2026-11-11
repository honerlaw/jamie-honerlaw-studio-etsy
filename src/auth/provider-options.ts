import { getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";

import { handleMcp } from "../mcp/handle-mcp";
import type { McpClient } from "./mcp-clients";
import { routeDefault } from "./route-default";

// The OAuth 2.1 authorization server (PKCE S256, discovery, token issuance and
// validation) in front of /mcp. There is deliberately no registration endpoint: the only
// clients are the ones in MCP_CLIENTS. The resource is this Worker's own /mcp.
export function providerOptions(origin: string, clients: readonly McpClient[]): OAuthProviderOptions<Env> {
  const options: OAuthProviderOptions<Env> = {
    apiRoute: "/mcp",
    apiHandler: {
      fetch: (request, env, ctx) => handleMcp(request, env, ctx, getOAuthApi(options, env), clients),
    },
    defaultHandler: {
      fetch: (request, env) => routeDefault(request, env, getOAuthApi(options, env)),
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      resource_name: "Etsy shop",
    },
  };
  return options;
}
