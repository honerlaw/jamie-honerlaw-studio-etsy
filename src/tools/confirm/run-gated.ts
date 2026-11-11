import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { base64url } from "../../vault/base64url";
import type { OneTimeStoreApi } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { argsHash } from "./args-hash";

const TOKEN_TTL_MS = 10 * 60 * 1000;
const STORED = z.object({ tool: z.string(), argsHash: z.string() });

// The text every gated tool's description ends with.
export const CONFIRM_INSTRUCTIONS =
  "This changes her shop in a way that costs money or can't be undone. Call it first " +
  "WITHOUT confirmation_token: that only returns a preview and a token. Show her the " +
  "preview and ask. Only if she says yes, call again with the same arguments plus the token.";

export interface GatedCall {
  readonly store: OneTimeStoreApi;
  readonly tool: string;
  readonly args: { readonly confirmation_token?: string | undefined };
  // Builds the preview, reading at most 2 things from Etsy. A CallToolResult means the
  // change can't go ahead (not found, wrong state) and is returned as it is.
  readonly preview: () => Promise<Record<string, unknown> | CallToolResult>;
  // The single write. Runs only on a confirmed second call.
  readonly write: () => Promise<CallToolResult>;
}

function isResult(value: Record<string, unknown> | CallToolResult): value is CallToolResult {
  return Array.isArray(value.content);
}

// Two-step confirmation for costly or destructive tools. The first call returns a
// preview and a random 128-bit token stored in the OneTimeStore with this tool's name and
// arguments hash. The write happens only on a second call carrying that token with
// identical arguments; the token is consumed atomically either way, so it works once.
export async function runGated(call: GatedCall): Promise<CallToolResult> {
  const hash = await argsHash(call.args);
  const token = call.args.confirmation_token;
  if (token === undefined || token === "") {
    const preview = await call.preview();
    if (isResult(preview)) {
      return preview;
    }
    const minted = base64url(crypto.getRandomValues(new Uint8Array(16)));
    await call.store.put(`confirm:${minted}`, JSON.stringify({ tool: call.tool, argsHash: hash }), TOKEN_TTL_MS);
    return toolText({
      preview,
      confirmation_token: minted,
      next_step: "Show her this preview. If she confirms, call again with identical arguments and this token.",
    });
  }
  const stored = STORED.safeParse(JSON.parse((await call.store.consume(`confirm:${token}`)) ?? "null"));
  if (!stored.success || stored.data.tool !== call.tool || stored.data.argsHash !== hash) {
    return toolText(
      "That confirmation token is expired, already used, or for different arguments. Nothing was " +
        "changed. Call again without confirmation_token for a fresh preview.",
      true,
    );
  }
  return call.write();
}
