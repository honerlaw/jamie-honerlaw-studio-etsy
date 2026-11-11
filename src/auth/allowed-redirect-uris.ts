// The documented OAuth callbacks of the MCP clients she uses. Dynamic client registration
// accepts only these, so a rogue client can't register its own endpoint under a
// convincing name and phish a grant.
const CLIENT_CALLBACKS = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

// The built-in list plus any comma-separated extras from the ALLOWED_REDIRECT_URIS var.
export function allowedRedirectUris(extra: string): readonly string[] {
  const extras = extra
    .split(",")
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
  return [...CLIENT_CALLBACKS, ...extras];
}
