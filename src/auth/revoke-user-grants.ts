import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// Revokes every MCP grant (and with it every token) issued to this user. The MCP clients'
// next call then gets a 401 and they re-run authorization. Returns how many it revoked.
export async function revokeUserGrants(oauth: OAuthHelpers, userId: string): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, cursor === undefined ? {} : { cursor });
    for (const grant of page.items) {
      await oauth.revokeGrant(grant.id, userId);
      revoked += 1;
    }
    cursor = page.cursor;
  } while (cursor !== undefined);
  return revoked;
}
