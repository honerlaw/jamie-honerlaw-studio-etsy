import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getShopOverview } from "../tools/get-shop-overview";
import type { ShopToolDeps } from "../tools/shop-tool-deps";

// The MCP server and its tools. Every tool declares readOnlyHint and destructiveHint.
export function buildMcpServer(deps: ShopToolDeps): McpServer {
  const server = new McpServer({ name: "etsy-shop", version: "1.0.0" });
  server.registerTool(
    "get_shop_overview",
    {
      title: "Shop overview",
      description:
        "Her Etsy shop's basics (name, currency, active listings, sales, reviews, vacation mode) " +
        "and the health of this connection: when the Etsy sign-in was last refreshed and when " +
        "the daily stats snapshot last ran.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    () => getShopOverview(deps),
  );
  return server;
}
