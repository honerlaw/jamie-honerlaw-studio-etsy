import { getOAuthApi, OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { logEvent } from "../log/log-event";
import { handleHealth } from "../routes/handle-health";
import { ensureClients } from "./ensure-clients";
import { parseMcpClients, type McpClient } from "./mcp-clients";
import { providerOptions } from "./provider-options";
import { requestedClientId } from "./requested-client-id";

const GATED_PATHS = new Set(["/authorize", "/token"]);

// Every request. Fails closed when MCP_CLIENTS is missing or malformed (only /health
// still answers). /authorize and /token are refused for any client not on the list,
// and the provider's client records are brought in line with the list first.
export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  let clients: readonly McpClient[];
  try {
    clients = parseMcpClients(env.MCP_CLIENTS);
  } catch {
    if (url.pathname === "/health") {
      return handleHealth();
    }
    logEvent("config_invalid", { reason: "mcp_clients" });
    return new Response("This server isn't configured correctly.", { status: 503 });
  }
  const options = providerOptions(url.origin, clients);
  if (GATED_PATHS.has(url.pathname)) {
    const clientId = await requestedClientId(request);
    if (!clients.some((client) => client.id === clientId)) {
      logEvent("client_refused", { route: url.pathname });
      return Response.json(
        { error: "invalid_client", error_description: "This app isn't allowed to connect to this server." },
        { status: 401 },
      );
    }
    await ensureClients(getOAuthApi(options, env), env, clients);
  }
  return new OAuthProvider<Env>(options).fetch(request, env, ctx);
}
