import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { etsyError } from "../etsy-error";
import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { withAccessToken } from "../with-access-token";

interface Node {
  readonly id: number;
  readonly name: string;
  readonly children?: readonly Node[] | null | undefined;
}

const NODE: z.ZodType<Node> = z.lazy(() =>
  z.object({ id: z.number(), name: z.string(), children: z.array(NODE).nullish() }),
);
const TREE = z.object({ results: z.array(NODE) });
const MAX_MATCHES = 25;

function* walk(
  nodes: readonly Node[],
  path: readonly string[],
): Generator<{ id: number; path: string; leaf: boolean }> {
  for (const node of nodes) {
    const here = [...path, node.name];
    const children = node.children ?? [];
    yield { id: node.id, path: here.join(" > "), leaf: children.length === 0 };
    yield* walk(children, here);
  }
}

// Finds Etsy categories (the seller taxonomy) whose path contains every word of the
// query. A listing needs a `taxonomy_id`; a leaf category is the most specific.
export async function searchCategories(deps: ShopToolDeps, args: { readonly query: string }): Promise<CallToolResult> {
  return withAccessToken(deps, async (token) => {
    const { data, response } = await deps.etsy(token).GET("/v3/application/seller-taxonomy/nodes");
    if (!response.ok) {
      return etsyError(response);
    }
    const tree = TREE.safeParse(data);
    if (!tree.success) {
      return toolText("Etsy returned the category list in an unexpected shape.", true);
    }
    const words = args.query
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word !== "");
    const matches = [...walk(tree.data.results, [])]
      .filter((node) => words.every((word) => node.path.toLowerCase().includes(word)))
      .sort((a, b) => Number(b.leaf) - Number(a.leaf));
    return toolText({
      matches: matches
        .slice(0, MAX_MATCHES)
        .map((node) => ({ taxonomy_id: node.id, path: node.path, leaf: node.leaf })),
      more: matches.length > MAX_MATCHES,
    });
  });
}
