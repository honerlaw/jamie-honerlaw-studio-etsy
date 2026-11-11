import { describe, expect, it } from "vitest";

import { createEtsyClient } from "../src/etsy/create-etsy-client";
import { describeEtsyStatus } from "../src/etsy/describe-etsy-status";
import { fetchEtsyMe } from "../src/etsy/fetch-etsy-me";
import { fetchWithRetry } from "../src/etsy/fetch-with-retry";
import { requestEtsyToken } from "../src/etsy/request-etsy-token";
import { sleep } from "../src/etsy/sleep";

function sequence(...responses: (() => Response)[]): { fetcher: typeof fetch; calls: Request[] } {
  const calls: Request[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(new Request(input, init));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve(next === undefined ? new Response(null, { status: 500 }) : next());
  };
  return { fetcher, calls };
}

describe("fetchWithRetry", () => {
  it("retries a 429 twice, honouring Retry-After, then gives up", async () => {
    const waits: number[] = [];
    const { fetcher, calls } = sequence(() => new Response(null, { status: 429, headers: { "retry-after": "3" } }));
    const response = await fetchWithRetry(fetcher, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    })(new Request("https://api.etsy.com/x", { method: "POST", body: "payload" }));
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(3);
    expect(waits).toStrictEqual([3000, 3000]);
    expect(await calls[2]?.text()).toBe("payload");
  });

  it("caps a long Retry-After and defaults a missing one to a second", async () => {
    const waits: number[] = [];
    const { fetcher } = sequence(
      () => new Response(null, { status: 429, headers: { "retry-after": "999" } }),
      () => new Response(null, { status: 429 }),
      () => new Response("ok"),
    );
    const response = await fetchWithRetry(fetcher, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    })(new Request("https://api.etsy.com/x"));
    expect(response.status).toBe(200);
    expect(waits).toStrictEqual([10_000, 1000]);
  });
});

describe("createEtsyClient", () => {
  it("sends keystring:shared_secret and the bearer token on every request", async () => {
    const { fetcher, calls } = sequence(() => Response.json({ user_id: 1, shop_id: 2 }));
    const client = createEtsyClient({ apiKey: "ks:ss", accessToken: "tok", fetch: fetcher, sleep });
    await client.GET("/v3/application/users/me");
    expect(calls[0]?.headers.get("x-api-key")).toBe("ks:ss");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok");
  });
});

describe("fetchEtsyMe", () => {
  const client = (response: () => Response) =>
    createEtsyClient({ apiKey: "k", accessToken: "t", fetch: sequence(response).fetcher, sleep });

  it("parses the user and shop ids", async () => {
    expect(await fetchEtsyMe(client(() => Response.json({ user_id: 1, shop_id: 2 })))).toStrictEqual({
      userId: "1",
      shopId: "2",
    });
  });

  it("returns an empty shop id for an account with no shop", async () => {
    expect(await fetchEtsyMe(client(() => Response.json({ user_id: 1 })))).toStrictEqual({ userId: "1", shopId: "" });
  });

  it("returns null on an error status, a bad shape, or a network failure", async () => {
    expect(await fetchEtsyMe(client(() => new Response("{}", { status: 401 })))).toBeNull();
    expect(await fetchEtsyMe(client(() => Response.json({ user_id: "x" })))).toBeNull();
    const throwing = createEtsyClient({
      apiKey: "k",
      accessToken: "t",
      fetch: () => Promise.reject(new Error("down")),
      sleep,
    });
    expect(await fetchEtsyMe(throwing)).toBeNull();
  });
});

describe("requestEtsyToken", () => {
  const form = { grant_type: "refresh_token", client_id: "ks", refresh_token: "r" };

  it("parses a token response and sends the API key", async () => {
    const { fetcher, calls } = sequence(() =>
      Response.json({ access_token: "a", refresh_token: "r2", expires_in: 3600, token_type: "Bearer" }),
    );
    expect(await requestEtsyToken(fetcher, "ks:ss", form)).toStrictEqual({
      kind: "ok",
      tokens: { accessToken: "a", refreshToken: "r2", expiresInSeconds: 3600 },
    });
    expect(calls[0]?.headers.get("x-api-key")).toBe("ks:ss");
  });

  it.each([
    ["invalid_grant", () => Response.json({ error: "invalid_grant" }, { status: 400 }), { kind: "invalid_grant" }],
    [
      "another OAuth error",
      () => Response.json({ error: "invalid_client" }, { status: 401 }),
      { kind: "unavailable", status: 401 },
    ],
    ["a non-JSON 502", () => new Response("<html>", { status: 502 }), { kind: "unavailable", status: 502 }],
    ["a 200 with the wrong shape", () => Response.json({ access_token: "a" }), { kind: "unavailable", status: 200 }],
  ])("maps %s", async (_case, response, expected) => {
    expect(await requestEtsyToken(sequence(response).fetcher, "k", form)).toStrictEqual(expected);
  });

  it("maps a network failure to unavailable with status 0", async () => {
    expect(await requestEtsyToken(() => Promise.reject(new Error("down")), "k", form)).toStrictEqual({
      kind: "unavailable",
      status: 0,
    });
  });
});

describe("describeEtsyStatus", () => {
  it.each([
    [401, /Reconnect/u],
    [403, /isn't allowed/u],
    [404, /couldn't find/u],
    [429, /rate-limiting/u],
    [503, /having trouble/u],
    [400, /HTTP 400/u],
  ])("explains %i without any response body", (status, pattern) => {
    expect(describeEtsyStatus(status)).toMatch(pattern);
  });
});

it("sleep resolves after the delay", async () => {
  await expect(sleep(1)).resolves.toBeUndefined();
});
