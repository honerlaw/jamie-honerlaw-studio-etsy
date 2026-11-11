import { vi } from "vitest";

// What the Worker sent. Bodies are read eagerly: a request made inside a Durable Object
// can't be read later from the test's context.
interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface EtsyMock {
  // Every request the Worker sent to Etsy, in order.
  readonly requests: RecordedRequest[];
  // Override one route's response. Keyed by "METHOD path", e.g. "GET /v3/application/users/me".
  readonly routes: Map<string, () => Response | Promise<Response>>;
}

export const TOKEN_ROUTE = "POST /v3/public/oauth/token";
export const ME_ROUTE = "GET /v3/application/users/me";
export const SHOP_ROUTE = "GET /v3/application/shops/2002";

const SHOP_BODY = {
  shop_id: 2002,
  shop_name: "JamieHonerlawStudio",
  title: "Handmade things",
  currency_code: "USD",
  url: "https://www.etsy.com/shop/JamieHonerlawStudio",
  listing_active_count: 12,
  transaction_sold_count: 340,
  review_count: 80,
  review_average: 4.9,
  is_vacation: false,
};

let tokenCounter = 0;

function tokenResponse(): Response {
  tokenCounter += 1;
  return Response.json({
    access_token: `1001.access-${String(tokenCounter)}`,
    refresh_token: `1001.refresh-${String(tokenCounter)}`,
    expires_in: 3600,
    token_type: "Bearer",
  });
}

// Replaces global fetch for the test: Etsy routes answer from `routes`, anything else
// fails the test (no real network). Default routes: a successful token exchange, getMe
// for the allowlisted user and shop, and getShop.
export function mockEtsy(): EtsyMock {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, () => Response | Promise<Response>>([
    [TOKEN_ROUTE, tokenResponse],
    [ME_ROUTE, () => Response.json({ user_id: 1001, shop_id: 2002 })],
    [SHOP_ROUTE, () => Response.json(SHOP_BODY)],
  ]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "api.etsy.com") {
      throw new Error(`unexpected outbound fetch to ${url.hostname}`);
    }
    requests.push({
      method: request.method,
      url: request.url,
      headers: new Headers(request.headers),
      body: new TextDecoder().decode(await request.clone().arrayBuffer()),
    });
    const route = routes.get(`${request.method} ${url.pathname}`);
    return route === undefined ? new Response("not mocked", { status: 500 }) : route();
  });
  return { requests, routes };
}
