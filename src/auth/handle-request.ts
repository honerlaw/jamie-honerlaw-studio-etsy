import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { logEvent } from "../log/log-event";
import { handleHealth } from "../routes/handle-health";
import { ensureClients } from "./ensure-clients";
import { parseMcpClients, type McpClient } from "./mcp-clients";
import { providerOptions } from "./provider-options";
import { requestedClientIds } from "./requested-client-ids";

const GATED_PATHS = new Set(["/authorize", "/token"]);

function unavailable(reason: string): Response {
  logEvent("config_invalid", { reason });
  return new Response("This server isn't configured correctly.", { status: 503 });
}

// Every request. Fails closed when MCP_CLIENTS is missing or malformed (only /health
// still answers). /authorize and /token are refused unless every client_id the request
// claims is on the list, and the provider's client records are brought in line with the
// list first; if that sync fails, the request fails closed too.
export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  let clients: readonly McpClient[];
  try {
    clients = parseMcpClients(env.MCP_CLIENTS);
  } catch {
    if (url.pathname === "/health") {
      return handleHealth();
    }
    return unavailable("mcp_clients");
  }
  const options = providerOptions(url.origin, clients);
  if (GATED_PATHS.has(url.pathname)) {
    const claimed = await requestedClientIds(request);
    const listed = new Set(clients.map((client) => client.id));
    if (claimed.length === 0 || !claimed.every((id) => listed.has(id))) {
      logEvent("client_refused", { route: url.pathname });
      return Response.json(
        { error: "invalid_client", error_description: "This app isn't allowed to connect to this server." },
        { status: 401 },
      );
    }
    try {
      await ensureClients(env, clients);
    } catch {
      return unavailable("client_sync");
    }
  }
  return new OAuthProvider(options).fetch(request, env, ctx);
}
