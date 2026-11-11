import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

import { toolText } from "./tool-text";

// Parses Etsy's data through an allowlist schema (unknown keys are dropped, so nothing
// the schema doesn't name reaches the chat) and returns it, or a fixed error.
export function shaped(schema: z.ZodType, data: unknown, what: string): CallToolResult {
  const parsed = schema.safeParse(data);
  return parsed.success ? toolText(parsed.data) : toolText(`Etsy returned ${what} in an unexpected shape.`, true);
}
