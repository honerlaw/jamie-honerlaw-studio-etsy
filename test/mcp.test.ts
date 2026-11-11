import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { handleMcp } from "../src/mcp/handle-mcp";
import { mockEtsy, SHOP_ROUTE, type EtsyMock } from "./support/etsy-mock";
import { connect, mcp, ORIGIN } from "./support/oauth-flow";

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
});

interface RpcResult {
  readonly result?: {
    readonly tools?: readonly { name: string; annotations?: Record<string, unknown> }[];
    readonly content?: readonly { type: string; text: string }[];
    readonly isError?: boolean;
  };
}

async function rpc(accessToken: string, method: string, params?: Record<string, unknown>): Promise<RpcResult> {
  const response = await mcp(accessToken, method, params);
  expect(response.status).toBe(200);
  return await response.json<RpcResult>();
}

async function overview(accessToken: string): Promise<{ text: string; isError: boolean }> {
  const body = await rpc(accessToken, "tools/call", { name: "get_shop_overview", arguments: {} });
  return { text: body.result?.content?.[0]?.text ?? "", isError: body.result?.isError === true };
}

describe("tools/list", () => {
  it("lists get_shop_overview with read-only, non-destructive annotations", async () => {
    const { accessToken } = await connect();
    const tools = (await rpc(accessToken, "tools/list")).result?.tools ?? [];
    const tool = tools.find((candidate) => candidate.name === "get_shop_overview");
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const each of tools) {
      expect(each.annotations).toHaveProperty("readOnlyHint");
      expect(each.annotations).toHaveProperty("destructiveHint");
    }
  });
});

describe("get_shop_overview", () => {
  it("returns shop data through Etsy and says the cron has not run yet", async () => {
    const { accessToken } = await connect();
    const { text, isError } = await overview(accessToken);
    expect(isError).toBe(false);
    const parsed = JSON.parse(text) as {
      shop: { shop_name: string };
      connection: { cron: string; etsy_tokens_obtained_at: string };
    };
    expect(parsed.shop.shop_name).toBe("JamieHonerlawStudio");
    expect(parsed.connection.cron).toBe("not yet run");
    expect(parsed.connection.etsy_tokens_obtained_at).toMatch(/^\d{4}-\d\d-\d\dT/u);
    for (const request of etsy.requests) {
      expect(request.headers.get("x-api-key")).toBe("test-keystring:test-shared-secret");
    }
  });

  it("reports the last cron run when one is recorded", async () => {
    const { accessToken } = await connect();
    await env.SHOP_KV.put("cron:last-run", '{"ranAt":"2026-11-10T06:00:00Z","ok":true}');
    expect(JSON.parse((await overview(accessToken)).text)).toMatchObject({
      connection: { cron: '{"ranAt":"2026-11-10T06:00:00Z","ok":true}' },
    });
  });

  it("explains an Etsy error without its body", async () => {
    const { accessToken } = await connect();
    etsy.routes.set(SHOP_ROUTE, () => new Response('{"error":"secret details"}', { status: 404 }));
    const { text, isError } = await overview(accessToken);
    expect(isError).toBe(true);
    expect(text).toBe("Etsy couldn't find that.");
  });

  it("flags a shop response in an unexpected shape", async () => {
    const { accessToken } = await connect();
    etsy.routes.set(SHOP_ROUTE, () => Response.json({ shop_name: 1 }));
    expect(await overview(accessToken)).toMatchObject({ isError: true });
  });

  it("revokes her grants and asks her to reconnect when the Etsy connection is gone", async () => {
    const { accessToken } = await connect();
    await env.ETSY_TOKEN_VAULT.getByName("2002").clear();
    const { text, isError } = await overview(accessToken);
    expect(isError).toBe(true);
    expect(text).toContain("reconnect");
    expect((await env.OAUTH_KV.list({ prefix: "grant:" })).keys).toHaveLength(0);
    expect((await mcp(accessToken, "tools/list")).status).toBe(401);
  });
});

describe("handleMcp re-checks", () => {
  const oauth = {} as OAuthHelpers;
  const request = () => new Request(`${ORIGIN}/mcp`, { method: "POST", body: "{}" });
  const ctx = (extra: Record<string, unknown>) => Object.assign(createExecutionContext(), extra);
  const props = { etsyUserId: "1001", shopId: "2002" };

  it("rejects a token issued for another resource (audience)", async () => {
    const response = await handleMcp(
      request(),
      env,
      ctx({ props, auth: { audience: "https://other.example/mcp" } }),
      oauth,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("rejects a request with no auth context", async () => {
    expect((await handleMcp(request(), env, ctx({ props }), oauth)).status).toBe(401);
  });

  it.each([
    ["another shop", { etsyUserId: "1001", shopId: "9" }],
    ["another user", { etsyUserId: "9", shopId: "2002" }],
    ["missing props", undefined],
  ])("refuses a grant for %s once the allowlist no longer matches", async (_case, grantProps) => {
    const response = await handleMcp(
      request(),
      env,
      ctx({ props: grantProps, auth: { audience: `${ORIGIN}/mcp` } }),
      oauth,
    );
    expect(response.status).toBe(403);
  });
});
