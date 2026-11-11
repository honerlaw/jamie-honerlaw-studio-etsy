import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { buildProvider } from "../src/auth/build-provider";
import { ME_ROUTE, mockEtsy, TOKEN_ROUTE, type EtsyMock } from "./support/etsy-mock";
import {
  call,
  CLAUDE_REDIRECT,
  etsyCallback,
  ORIGIN,
  startAuthorization,
  type EtsyRedirect,
} from "./support/oauth-flow";

let etsy: EtsyMock;

beforeEach(() => {
  etsy = mockEtsy();
});

async function grantCount(): Promise<number> {
  return (await env.OAUTH_KV.list({ prefix: "grant:" })).keys.length;
}

async function vaultConnected(): Promise<boolean> {
  return (await env.ETSY_TOKEN_VAULT.getByName("2002").status()).connected;
}

// Runs the callback through the real Worker but with some env values replaced.
function callbackWithEnv(redirect: EtsyRedirect, overrides: Partial<Env>): Promise<Response> {
  const state = redirect.etsyUrl.searchParams.get("state") ?? "";
  const request = new Request(`${ORIGIN}/callback?code=etsy-code&state=${state}`, {
    headers: { cookie: redirect.jar.header() },
    redirect: "manual",
  });
  const overridden = { ...env, ...overrides };
  return buildProvider(overridden, ORIGIN).fetch(request, overridden, createExecutionContext());
}

describe("redirect to Etsy", () => {
  it("asks Etsy for the derived scopes with PKCE S256 and our callback", async () => {
    const { etsyUrl, jar } = await startAuthorization();
    expect(etsyUrl.origin + etsyUrl.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(etsyUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(etsyUrl.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    expect(etsyUrl.searchParams.get("client_id")).toBe("test-keystring");
    expect(etsyUrl.searchParams.get("scope")).toBe(
      "listings_d listings_r listings_w shops_r transactions_r transactions_w",
    );
    expect(jar.header()).toContain(`__Host-etsy-oauth-state=${etsyUrl.searchParams.get("state") ?? ""}`);
  });
});

describe("callback state", () => {
  it("rejects an unknown state with a 400", async () => {
    const redirect = await startAuthorization();
    const response = await etsyCallback(redirect, "made-up-state");
    expect(response.status).toBe(400);
  });

  it("rejects a state this browser didn't start (no cookie)", async () => {
    const redirect = await startAuthorization();
    const state = redirect.etsyUrl.searchParams.get("state") ?? "";
    const response = await call(`/callback?code=etsy-code&state=${state}`);
    expect(response.status).toBe(400);
  });

  it("rejects a replayed state", async () => {
    const redirect = await startAuthorization();
    expect((await etsyCallback(redirect)).status).toBe(302);
    expect((await etsyCallback(redirect)).status).toBe(400);
  });

  it("sends the client access_denied when she declines on Etsy", async () => {
    const redirect = await startAuthorization();
    const state = redirect.etsyUrl.searchParams.get("state") ?? "";
    const response = await call(`/callback?error=access_denied&state=${state}`, {
      headers: { cookie: redirect.jar.header() },
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("client-state");
  });
});

describe("Etsy failures during sign-in", () => {
  it("returns a 502 when Etsy refuses the code", async () => {
    etsy.routes.set(TOKEN_ROUTE, () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const response = await etsyCallback(await startAuthorization());
    expect(response.status).toBe(502);
    expect(await grantCount()).toBe(0);
  });

  it("returns a 502 when getMe fails", async () => {
    etsy.routes.set(ME_ROUTE, () => new Response("{}", { status: 500 }));
    const response = await etsyCallback(await startAuthorization());
    expect(response.status).toBe(502);
    expect(await vaultConnected()).toBe(false);
  });
});

describe("allowlist", () => {
  it("completes authorization for the allowlisted user and shop", async () => {
    const response = await etsyCallback(await startAuthorization());
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT);
    expect(location.searchParams.get("code")).not.toBeNull();
    expect(location.searchParams.get("state")).toBe("client-state");
    expect(await grantCount()).toBe(1);
    expect(await vaultConnected()).toBe(true);
  });

  it.each([
    ["another user", { user_id: 9999, shop_id: 2002 }],
    ["another shop", { user_id: 1001, shop_id: 8888 }],
    ["an account with no shop", { user_id: 1001, shop_id: null }],
  ])("refuses %s with a 403, no grant and no stored tokens", async (_case, me) => {
    etsy.routes.set(ME_ROUTE, () => Response.json(me));
    const response = await etsyCallback(await startAuthorization());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/9999|8888/u);
    expect(await grantCount()).toBe(0);
    expect(await vaultConnected()).toBe(false);
  });

  it.each([
    ["the user id", { ALLOWED_ETSY_USER_ID: "" }],
    ["the shop id", { ALLOWED_ETSY_SHOP_ID: " " }],
  ])("fails closed with a 403 when %s is unset", async (_case, overrides) => {
    const response = await callbackWithEnv(await startAuthorization(), overrides);
    expect(response.status).toBe(403);
    expect(await grantCount()).toBe(0);
    expect(await vaultConnected()).toBe(false);
  });
});

describe("bootstrap mode", () => {
  it("shows the ids and grants nothing when ALLOWLIST_BOOTSTRAP is true", async () => {
    etsy.routes.set(ME_ROUTE, () => Response.json({ user_id: 4242, shop_id: 5353 }));
    const response = await callbackWithEnv(await startAuthorization(), { ALLOWLIST_BOOTSTRAP: "true" });
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("4242");
    expect(page).toContain("5353");
    expect(await grantCount()).toBe(0);
    expect(await vaultConnected()).toBe(false);
  });

  it("never shows the ids when bootstrap is off", async () => {
    etsy.routes.set(ME_ROUTE, () => Response.json({ user_id: 4242, shop_id: 5353 }));
    const response = await etsyCallback(await startAuthorization());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/4242|5353/u);
  });
});

describe("consent page", () => {
  it("names the client and the redirect host, and can't be framed", async () => {
    const { registerClient } = await import("./support/oauth-flow");
    const registered = await (await registerClient()).json<{ client_id: string }>();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: CLAUDE_REDIRECT,
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    const response = await call(`/authorize?${query.toString()}`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("Claude");
    expect(page).toContain("claude.ai");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("renders an unknown client locally instead of redirecting", async () => {
    const response = await call(`/authorize?response_type=code&client_id=nope&redirect_uri=${CLAUDE_REDIRECT}`);
    expect(response.status).toBe(400);
  });

  it("refuses a consent form posted without this browser's binding cookie", async () => {
    const response = await call("/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: "forged", decision: "approve" }),
    });
    expect(response.status).toBe(400);
  });

  it("sends the client access_denied when she cancels", async () => {
    const { CookieJar, registerClient } = await import("./support/oauth-flow");
    const registered = await (await registerClient()).json<{ client_id: string }>();
    const jar = new CookieJar();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: CLAUDE_REDIRECT,
      state: "s1",
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    });
    const page = await call(`/authorize?${query.toString()}`);
    jar.absorb(page);
    const handle = /name="handle" value="([^"]+)"/u.exec(await page.text())?.[1] ?? "";
    const response = await call("/authorize", {
      method: "POST",
      headers: { cookie: jar.header(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle, decision: "deny" }),
    });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe("access_denied");
  });

  it("allows only GET and POST", async () => {
    const response = await call("/authorize", { method: "PUT" });
    expect(response.status).toBe(405);
  });
});

it("returns 404 for unknown routes and non-GET callbacks", async () => {
  expect((await call("/nope")).status).toBe(404);
  expect((await call("/callback", { method: "POST" })).status).toBe(404);
});
