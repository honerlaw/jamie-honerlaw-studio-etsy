import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ShopToolDeps } from "../tools/shop-tool-deps";
import { registerCommerceTools } from "./register-commerce-tools";
import { registerListingTools } from "./register-listing-tools";
import { registerShopTools } from "./register-shop-tools";

// The MCP server and its tools. Every tool declares readOnlyHint and destructiveHint;
// test/tools.test.ts checks the registered set equals TOOL_OPERATIONS in etsy-scopes.ts.
export function buildMcpServer(deps: ShopToolDeps): McpServer {
  const server = new McpServer({ name: "etsy-shop", version: "1.0.0" });
  registerShopTools(server, deps);
  registerListingTools(server, deps);
  registerCommerceTools(server, deps);
  return server;
}
