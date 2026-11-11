import { createScheduledController, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { runDailySnapshot } from "../src/cron/run-daily-snapshot";
import worker from "../src/index";
import { getShopOverview } from "../src/tools/get-shop-overview";
import { mockEtsy, TOKEN_ROUTE, type EtsyMock } from "./support/etsy-mock";
import { toolDeps } from "./support/tool-deps";
import { resultJson } from "./support/tool-result";

const LISTINGS = "GET /v3/application/shops/2002/listings";
const NOW = Date.parse("2026-11-10T06:17:00Z");

let etsy: EtsyMock;

function activeListings(total: number): () => Response {
  return () => {
    const url = new URL(etsy.requests.at(-1)?.url ?? "");
    const offset = Number(url.searchParams.get("offset"));
    const results = Array.from({ length: Math.max(0, Math.min(100, total - offset)) }, (_, index) => ({
      listing_id: offset + index + 1,
      views: (offset + index) * 2,
    }));
    return Response.json({ count: total, results });
  };
}

async function lastRun(): Promise<Record<string, unknown>> {
  return JSON.parse((await env.SHOP_KV.get("cron:last-run")) ?? "{}") as Record<string, unknown>;
}

beforeEach(async () => {
  etsy = mockEtsy();
  etsy.routes.set(LISTINGS, activeListings(250));
  await env.ETSY_TOKEN_VAULT.getByName("2002").store({ accessToken: "a0", refreshToken: "r0", expiresInSeconds: 1 });
});

describe("the daily snapshot", () => {
  it("refreshes the token, pages the active listings and writes one views key", async () => {
    await runDailySnapshot(env, NOW);
    expect(etsy.requests[0]?.url).toContain("/oauth/token");
    const pages = etsy.reads().map((request) => new URL(request.url).searchParams);
    expect(pages.map((query) => query.get("offset"))).toStrictEqual(["0", "100", "200"]);
    expect(pages.every((query) => query.get("state") === "active" && query.get("limit") === "100")).toBe(true);
    const keys = (await env.SHOP_KV.list({ prefix: "views:" })).keys.map((key) => key.name);
    expect(keys).toStrictEqual(["views:2026-11-10"]);
    const views = JSON.parse((await env.SHOP_KV.get("views:2026-11-10")) ?? "{}") as Record<string, number>;
    expect(Object.keys(views)).toHaveLength(250);
    expect(views["2"]).toBe(2);
    expect(await lastRun()).toStrictEqual({ ranAt: "2026-11-10T06:17:00.000Z", ok: true, listings: 250 });
  });

  it("stops at 35 pages and records that it was truncated", async () => {
    etsy.routes.set(LISTINGS, activeListings(4000));
    await runDailySnapshot(env, NOW);
    expect(etsy.reads()).toHaveLength(35);
    expect(await lastRun()).toMatchObject({ ok: true, listings: 3500, truncated: true });
  });

  it("saves no partial snapshot when Etsy keeps rate limiting part-way", async () => {
    const pages = activeListings(500);
    etsy.routes.set(LISTINGS, () => (etsy.reads().length > 2 ? new Response(null, { status: 429 }) : pages()));
    await runDailySnapshot(env, NOW);
    expect(await lastRun()).toMatchObject({
      ok: false,
      error: "Etsy kept rate limiting, so no snapshot was saved today.",
    });
    expect(await env.SHOP_KV.get("views:2026-11-10")).toBeNull();
  });

  it.each([
    [
      "Etsy refusing the refresh",
      () => etsy.routes.set(TOKEN_ROUTE, () => Response.json({ error: "invalid_grant" }, { status: 400 })),
      "Etsy isn't connected.",
    ],
    [
      "Etsy being down for the refresh",
      () => etsy.routes.set(TOKEN_ROUTE, () => new Response(null, { status: 503 })),
      "Etsy was unavailable.",
    ],
    [
      "a failed listings page",
      () => etsy.routes.set(LISTINGS, () => new Response(null, { status: 500 })),
      "Etsy answered HTTP 500.",
    ],
    [
      "an odd listings page",
      () => etsy.routes.set(LISTINGS, () => Response.json({ count: "x" })),
      "Etsy answered HTTP 200.",
    ],
  ])("records %s as a failure without a views key", async (_case, arrange, error) => {
    arrange();
    await runDailySnapshot(env, NOW);
    expect(await lastRun()).toStrictEqual({ ranAt: "2026-11-10T06:17:00.000Z", ok: false, error });
    expect((await env.SHOP_KV.list({ prefix: "views:" })).keys).toHaveLength(0);
  });

  it("records an unset allowlist and an unexpected error", async () => {
    await runDailySnapshot({ ...env, ALLOWED_ETSY_SHOP_ID: "unset" }, NOW);
    expect(await lastRun()).toMatchObject({ ok: false, error: "The shop allowlist isn't set." });
    const broken = {
      ...env,
      ETSY_TOKEN_VAULT: { getByName: () => ({ getAccessToken: () => Promise.reject(new Error("boom")) }) },
    };
    await runDailySnapshot(broken as unknown as Env, NOW);
    expect(await lastRun()).toMatchObject({ ok: false, error: "Unexpected error; see the Worker logs." });
  });

  it("runs from the Worker's scheduled handler, and get_shop_overview shows the result", async () => {
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "17 6 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await lastRun()).toMatchObject({ ok: true });
    etsy.routes.set("GET /v3/application/shops/2002", () =>
      Response.json({
        shop_name: "S",
        currency_code: "USD",
        url: "u",
        listing_active_count: 1,
        transaction_sold_count: 1,
        is_vacation: false,
      }),
    );
    const deps = toolDeps({ readCronStatus: () => env.SHOP_KV.get("cron:last-run") });
    expect(resultJson<{ connection: { cron: string } }>(await getShopOverview(deps)).connection.cron).toContain(
      '"ok":true',
    );
  });
});
