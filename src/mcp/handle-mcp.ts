import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import type { McpClient } from "../auth/mcp-clients";
import { revokeUserGrants } from "../auth/revoke-user-grants";
import { createEtsyClient } from "../etsy/create-etsy-client";
import { etsyApiKey } from "../etsy/etsy-api-key";
import { sleep } from "../etsy/sleep";
import { buildMcpServer } from "./build-mcp-server";

const PROPS = z.object({ etsyUserId: z.string().min(1), shopId: z.string().min(1) });
const AUTH = z.object({ audience: z.string(), clientId: z.string().optional() });

// The MCP endpoint, reached only with a token the provider has already validated. It
// re-checks three things itself: that the token was issued for this /mcp resource, that
// its client is still on MCP_CLIENTS, and that the grant still belongs to the
// allowlisted user and shop. Removing a client or changing the allowlist therefore cuts
// off existing tokens at once. Each request gets a fresh stateless MCP server.
export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  oauth: OAuthHelpers,
  clients: readonly McpClient[],
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const auth = AUTH.safeParse(Reflect.get(ctx, "auth"));
  if (
    !auth.success ||
    auth.data.audience !== `${origin}/mcp` ||
    !clients.some((client) => client.id === auth.data.clientId)
  ) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "www-authenticate": 'Bearer error="invalid_token"' },
    });
  }
  const props = PROPS.safeParse(ctx.props);
  if (
    !props.success ||
    props.data.shopId !== env.ALLOWED_ETSY_SHOP_ID.trim() ||
    props.data.etsyUserId !== env.ALLOWED_ETSY_USER_ID.trim()
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const { etsyUserId, shopId } = props.data;
  const vault = env.ETSY_TOKEN_VAULT.getByName(shopId);
  const apiKey = etsyApiKey(env);
  const server = buildMcpServer({
    shopId,
    getAccessToken: () => vault.getAccessToken(),
    vaultStatus: () => vault.status(),
    etsy: (accessToken) => createEtsyClient({ apiKey, accessToken, fetch: (r) => fetch(r), sleep }),
    readCronStatus: () => env.SHOP_KV.get("cron:last-run"),
    revokeGrants: async () => {
      await revokeUserGrants(oauth, etsyUserId);
    },
  });
  // No session id generator: stateless mode, plain JSON responses.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
