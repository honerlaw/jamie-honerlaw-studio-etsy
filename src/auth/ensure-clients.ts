import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { base64url } from "../vault/base64url";
import type { McpClient } from "./mcp-clients";

const SYNC_PREFIX = "mcp-client-sync:";

async function fingerprint(client: McpClient): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(client)));
  return base64url(new Uint8Array(digest));
}

// Makes the OAuth provider's client records match MCP_CLIENTS. Each entry is written only
// when it changed (a fingerprint in SHOP_KV), so normal requests cost one KV read per
// client. A new client gets a minimal base record (the shape the pinned library's own
// createClient writes, without a secret), then the provider's public updateClient sets
// its name, redirect URIs and secret (the library hashes the secret itself).
// test/clients.test.ts runs the whole flow against these records, so a library change
// that breaks them fails CI.
export async function ensureClients(
  oauth: OAuthHelpers,
  env: Pick<Env, "OAUTH_KV" | "SHOP_KV">,
  clients: readonly McpClient[],
): Promise<void> {
  for (const client of clients) {
    const print = await fingerprint(client);
    if ((await env.SHOP_KV.get(`${SYNC_PREFIX}${client.id}`)) === print) {
      continue;
    }
    if ((await oauth.lookupClient(client.id)) === null) {
      await env.OAUTH_KV.put(
        `client:${client.id}`,
        JSON.stringify({
          clientId: client.id,
          redirectUris: client.redirectUris,
          clientName: client.name,
          grantTypes: ["authorization_code", "refresh_token"],
          responseTypes: ["code"],
          registrationDate: Math.floor(Date.now() / 1000),
          tokenEndpointAuthMethod: "client_secret_basic",
        }),
      );
    }
    await oauth.updateClient(client.id, {
      clientName: client.name,
      redirectUris: [...client.redirectUris],
      clientSecret: client.secret,
    });
    await env.SHOP_KV.put(`${SYNC_PREFIX}${client.id}`, print);
  }
}
