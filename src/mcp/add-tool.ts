import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolDefinition<Input extends z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: Input;
  // Every tool states both hints, so clients can tell reads from changes.
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly meta?: Record<string, unknown>;
  readonly run: (args: z.output<Input>) => Promise<CallToolResult>;
}

// Registers one tool. The SDK validates arguments against `input`; `run` gets them parsed
// once more here, with defaults applied and the precise type (the SDK's generic callback
// type can't carry it through). Every tool reaches Etsy, hence openWorldHint.
export function addTool<Input extends z.ZodObject>(server: McpServer, tool: ToolDefinition<Input>): void {
  const schema: z.ZodObject = tool.input;
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: schema,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.destructive, openWorldHint: true },
      ...(tool.meta === undefined ? {} : { _meta: tool.meta }),
    },
    (args) => tool.run(tool.input.parse(args)),
  );
}
