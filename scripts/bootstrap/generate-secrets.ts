// Secrets the bootstrap can make itself. Only missing ones are generated; an
// existing value is never replaced.

export type RandomBytes = (size: number) => Buffer;

const CLIENTS = [
  {
    id: "claude",
    name: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
  },
  { id: "chatgpt", name: "ChatGPT", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] },
] as const;

function firstKeyId(keys: string): string {
  const [first] = Object.keys(JSON.parse(keys) as Record<string, unknown>);
  if (first === undefined) {
    throw new Error("TOKEN_ENC_KEYS in Doppler has no key id.");
  }
  return first;
}

/** Values for every generatable secret that `existing` lacks. */
export function generateMissing(
  existing: Readonly<Record<string, string>>,
  random: RandomBytes,
): Record<string, string> {
  const generated: Record<string, string> = {};
  const key = (): string => random(32).toString("base64");
  const existingKeys = existing["TOKEN_ENC_KEYS"];
  const kid = existing["TOKEN_ENC_KID"] ?? (existingKeys === undefined ? "k1" : firstKeyId(existingKeys));
  if (existingKeys === undefined) {
    generated["TOKEN_ENC_KEYS"] = JSON.stringify({ [kid]: key() });
  }
  if (existing["TOKEN_ENC_KID"] === undefined) {
    generated["TOKEN_ENC_KID"] = kid;
  }
  if (existing["UPLOAD_SIGNING_KEY"] === undefined) {
    generated["UPLOAD_SIGNING_KEY"] = key();
  }
  if (existing["MCP_CLIENTS"] === undefined) {
    generated["MCP_CLIENTS"] = JSON.stringify(CLIENTS.map((client) => ({ ...client, secret: key() })));
  }
  for (const name of ["ALLOWED_ETSY_USER_ID", "ALLOWED_ETSY_SHOP_ID"]) {
    if (existing[name] === undefined) {
      generated[name] = "unset";
    }
  }
  return generated;
}
