import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { describeEtsyStatus } from "../etsy/describe-etsy-status";
import { toolText } from "./tool-text";

// The tool result for a failed Etsy call. Never quotes Etsy's body (buyer details).
export function etsyError(response: Response): CallToolResult {
  return toolText(describeEtsyStatus(response.status), true);
}
