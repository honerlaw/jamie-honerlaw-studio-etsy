import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ShopToolDeps } from "../shop-tool-deps";
import { toolText } from "../tool-text";
import { METRICS_NOTE } from "./metrics-note";
import { viewsTrend, type Snapshot } from "./views-trend";

const SNAPSHOT = z.record(z.string(), z.number());

// A stored snapshot, or null when there is none or it's unreadable (it's then skipped).
function parseJson(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
}
const DAY_MS = 24 * 60 * 60 * 1000;

// Views over the last `days` days, from this server's own daily snapshots (Etsy only
// reports lifetime totals). Reads storage only; no Etsy call.
export async function getViewsTrend(
  deps: ShopToolDeps,
  args: { readonly days: number },
  now: number = Date.now(),
): Promise<CallToolResult> {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));
  const wanted = Array.from({ length: args.days }, (_, index) =>
    new Date(today - (args.days - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
  const snapshots: { day: string; views: Snapshot }[] = [];
  for (const day of wanted) {
    const parsed = SNAPSHOT.safeParse(parseJson(await deps.readViewsSnapshot(day)));
    if (parsed.success) {
      snapshots.push({ day, views: parsed.data });
    }
  }
  if (snapshots.length < 2) {
    return toolText({
      message: "Not enough daily snapshots yet. The server records views once a day; a trend needs at least two days.",
      snapshots: snapshots.length,
      note: METRICS_NOTE,
    });
  }
  return toolText({ ...viewsTrend(snapshots), note: METRICS_NOTE });
}
