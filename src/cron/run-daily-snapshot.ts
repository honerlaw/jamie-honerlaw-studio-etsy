import { z } from "zod";

import { createEtsyClient } from "../etsy/create-etsy-client";
import { etsyApiKey } from "../etsy/etsy-api-key";
import { etsySubrequestBudget } from "../etsy/etsy-subrequest-budget";
import { fetchPages } from "../etsy/fetch-pages";
import { sleep } from "../etsy/sleep";
import { logEvent } from "../log/log-event";

// 35 pages of 100 active listings (3,500 listings): under Workers Free's 50
// subrequests, with room for the token refresh.
const MAX_PAGES = 35;
const SNAPSHOT_TTL_SECONDS = 120 * 24 * 60 * 60;
const PAGE = z.object({
  count: z.number(),
  results: z.array(z.object({ listing_id: z.number(), views: z.number().nullish() })),
});

interface CronStatus {
  readonly ranAt: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly listings?: number;
  readonly truncated?: boolean;
}

async function snapshot(env: Env, now: number): Promise<CronStatus> {
  const ranAt = new Date(now).toISOString();
  const shopId = env.ALLOWED_ETSY_SHOP_ID.trim();
  if (!/^\d+$/u.test(shopId)) {
    return { ranAt, ok: false, error: "The shop allowlist isn't set." };
  }
  // Reading a token refreshes it when it's stale, so the daily run also keeps the
  // 90-day Etsy refresh token from ever sitting unused.
  const access = await env.ETSY_TOKEN_VAULT.getByName(shopId).getAccessToken();
  if (!access.ok) {
    return {
      ranAt,
      ok: false,
      error: access.reason === "reconnect" ? "Etsy isn't connected." : "Etsy was unavailable.",
    };
  }
  const etsy = createEtsyClient({
    apiKey: etsyApiKey(env),
    accessToken: access.accessToken,
    fetch: (r) => fetch(r),
    sleep,
    budget: etsySubrequestBudget(),
  });
  const pages = await fetchPages(
    async (offset, limit) => {
      const { data, response } = await etsy.GET("/v3/application/shops/{shop_id}/listings", {
        params: { path: { shop_id: Number(shopId) }, query: { state: "active", limit, offset } },
      });
      const page = response.ok ? PAGE.safeParse(data) : null;
      return page?.success === true
        ? { ok: true, count: page.data.count, results: page.data.results }
        : { ok: false, response };
    },
    { pageSize: 100, maxPages: MAX_PAGES },
  );
  if (!pages.ok) {
    return { ranAt, ok: false, error: `Etsy answered HTTP ${String(pages.response.status)}.` };
  }
  // A read cut short by rate limiting holds an arbitrary subset; saved, it would look
  // like a drop in views the next day. The page cap stops at the same place daily.
  if (pages.rateLimited) {
    return { ranAt, ok: false, error: "Etsy kept rate limiting, so no snapshot was saved today." };
  }
  const views = Object.fromEntries(pages.items.map((listing) => [String(listing.listing_id), listing.views ?? 0]));
  await env.SHOP_KV.put(`views:${ranAt.slice(0, 10)}`, JSON.stringify(views), {
    expirationTtl: SNAPSHOT_TTL_SECONDS,
  });
  return { ranAt, ok: true, listings: pages.items.length, ...(pages.truncated ? { truncated: true } : {}) };
}

// The daily cron: one views snapshot (`views:YYYY-MM-DD`, one KV write) and its status
// in `cron:last-run`, which get_shop_overview shows. Failures are recorded, not thrown.
export async function runDailySnapshot(env: Env, now: number = Date.now()): Promise<void> {
  let status: CronStatus;
  try {
    status = await snapshot(env, now);
  } catch {
    status = { ranAt: new Date(now).toISOString(), ok: false, error: "Unexpected error; see the Worker logs." };
  }
  logEvent("cron_ran", { outcome: status.ok ? "ok" : "failed" });
  await env.SHOP_KV.put("cron:last-run", JSON.stringify(status));
}
