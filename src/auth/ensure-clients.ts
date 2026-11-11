import { z } from "zod";

import type { McpClient } from "./mcp-clients";

// The fields of a stored client record this sync compares against MCP_CLIENTS.
const STORED = z.object({
  clientSecret: z.string(),
  clientName: z.string(),
  redirectUris: z.array(z.string()),
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Makes the OAuth provider's client records match MCP_CLIENTS. Each record is read and
// compared, and rewritten in one put only when it is missing or differs, so a lost or
// stale record repairs itself on the next sign-in or token request. The record has the
// shape the pinned library's own createClient writes, with the secret stored as the
// library stores it (SHA-256 hex). test/clients.test.ts and every connect() in the test
// suites run the library's token endpoint against these records, so a library change
// that breaks them fails CI.
export async function ensureClients(env: Pick<Env, "OAUTH_KV">, clients: readonly McpClient[]): Promise<void> {
  for (const client of clients) {
    const key = `client:${client.id}`;
    const secretHash = await sha256Hex(client.secret);
    const stored = STORED.safeParse(await env.OAUTH_KV.get(key, "json"));
    if (
      stored.success &&
      stored.data.clientSecret === secretHash &&
      stored.data.clientName === client.name &&
      stored.data.redirectUris.join("\n") === client.redirectUris.join("\n")
    ) {
      continue;
    }
    await env.OAUTH_KV.put(
      key,
      JSON.stringify({
        clientId: client.id,
        clientSecret: secretHash,
        redirectUris: client.redirectUris,
        clientName: client.name,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        registrationDate: Math.floor(Date.now() / 1000),
        tokenEndpointAuthMethod: "client_secret_basic",
      }),
    );
  }
}
