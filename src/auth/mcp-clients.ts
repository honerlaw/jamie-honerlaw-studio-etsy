import { z } from "zod";

// One MCP client app she has allowed to connect (Claude, ChatGPT, …). Confidential: the
// app must present `secret` at the token endpoint, so a code alone is useless to anyone
// who points their own copy of the app at this server.
export interface McpClient {
  readonly id: string;
  readonly name: string;
  readonly secret: string;
  readonly redirectUris: readonly string[];
}

// The library refuses a registered redirect URI with a fragment or user info, so the
// config does too, rather than every sign-in failing later.
function isPlainRedirect(uri: string): boolean {
  const url = new URL(uri);
  return !uri.includes("#") && url.username === "" && url.password === "";
}

const CLIENTS = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/u),
      name: z.string().min(1).max(60),
      secret: z.string().min(32),
      redirectUris: z.array(z.url({ protocol: /^https$/u }).refine(isPlainRedirect)).min(1),
    }),
  )
  .min(1)
  .refine((clients) => new Set(clients.map((client) => client.id)).size === clients.length);

// Parses the MCP_CLIENTS secret: the complete list of apps allowed to connect. Throws a
// fixed message on anything malformed (never one that quotes the secret), and the caller
// fails closed.
export function parseMcpClients(json: string): readonly McpClient[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new TypeError("MCP_CLIENTS is not valid JSON");
  }
  const parsed = CLIENTS.safeParse(decoded);
  if (!parsed.success) {
    throw new TypeError(
      "MCP_CLIENTS must be a non-empty list of {id, name, secret (32+ chars), redirectUris (plain https)}",
    );
  }
  return parsed.data;
}
