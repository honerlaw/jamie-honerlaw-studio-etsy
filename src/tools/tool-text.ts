import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// A tool result carrying one text block: JSON for data, a sentence for errors.
export function toolText(value: unknown, isError = false): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
