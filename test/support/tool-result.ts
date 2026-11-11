import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// The text of a tool result's first block.
export function resultText(result: CallToolResult): string {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
}

// A tool result's JSON payload, typed as the caller expects (like Response.json<T>()).
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the shape it asserts on, as with Response.json<T>()
export function resultJson<T>(result: CallToolResult): T {
  return JSON.parse(resultText(result)) as T;
}
