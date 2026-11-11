import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ShopToolDeps } from "./shop-tool-deps";
import { toolText } from "./tool-text";

const RECONNECT_MESSAGE = "Etsy connection expired — open the connector settings and reconnect.";
const UNAVAILABLE_MESSAGE = "Etsy can't be reached right now. Try again in a minute.";

// Runs `work` with a live Etsy access token. If the connection is gone for good (Etsy
// refused the refresh token, or nothing is stored) her MCP grants are revoked, so the
// client's next call gets a 401 and walks her through connecting again.
export async function withAccessToken(
  deps: ShopToolDeps,
  work: (accessToken: string) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const access = await deps.getAccessToken();
  if (access.ok) {
    return work(access.accessToken);
  }
  if (access.reason === "unavailable") {
    return toolText(UNAVAILABLE_MESSAGE, true);
  }
  await deps.revokeGrants();
  return toolText(RECONNECT_MESSAGE, true);
}
