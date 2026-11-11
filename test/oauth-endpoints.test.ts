import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { mockEtsy } from "./support/etsy-mock";
import { call, CLAUDE_REDIRECT, connect, mcp, ORIGIN, registerClient } from "./support/oauth-flow";

// These pin the behaviour of the exactly pinned @cloudflare/workers-oauth-provider
// version as this Worker configures it, rather than assuming it.

beforeEach(() => {
  mockEtsy();
});

async function tokenRequest(form: Record<string, string>): Promise<Response> {
  return call("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
}

describe("discovery", () => {
  it("serves authorization-server metadata with PKCE S256 and registration", async () => {
    const response = await call("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    const metadata = await response.json<Record<string, unknown>>();
    expect(metadata["code_challenge_methods_supported"]).toContain("S256");
    expect(metadata["registration_endpoint"]).toBe(`${ORIGIN}/register`);
    expect(metadata["authorization_endpoint"]).toBe(`${ORIGIN}/authorize`);
    expect(metadata["token_endpoint"]).toBe(`${ORIGIN}/token`);
  });

  it("serves protected-resource metadata for /mcp", async () => {
    const response = await call("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    const metadata = await response.json<Record<string, unknown>>();
    expect(metadata["resource"]).toBe(`${ORIGIN}/mcp`);
    expect(metadata["authorization_servers"]).toStrictEqual([ORIGIN]);
  });
});

describe("dynamic client registration", () => {
  it.each([
    ["ChatGPT", ["https://chatgpt.com/connector_platform_oauth_redirect"]],
    ["Claude (claude.ai)", [CLAUDE_REDIRECT]],
    ["Claude (claude.com)", ["https://claude.com/api/mcp/auth_callback"]],
  ])("accepts %s's documented redirect URI", async (_client, uris) => {
    const response = await registerClient(uris);
    expect(response.status).toBe(201);
  });

  it.each([
    ["an unknown host", ["https://evil.example/callback"]],
    ["a look-alike path", ["https://claude.ai/api/mcp/auth_callback/../evil"]],
    ["one good and one bad URI", [CLAUDE_REDIRECT, "https://evil.example/callback"]],
    ["no redirect URIs", []],
  ])("rejects %s with a 400", async (_case, uris) => {
    const response = await registerClient(uris);
    expect(response.status).toBe(400);
  });
});

describe("token endpoint and /mcp protection", () => {
  it("answers /mcp without a token with a 401 challenge naming the resource metadata", async () => {
    const response = await call("/mcp", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("rejects a malformed token", async () => {
    const response = await mcp("not-a-real-token", "tools/list");
    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const { accessToken } = await connect();
    const keys = await env.OAUTH_KV.list({ prefix: "token:" });
    for (const { name } of keys.keys) {
      const record = await env.OAUTH_KV.get<Record<string, unknown>>(name, "json");
      expect(record).toHaveProperty("expiresAt");
      await env.OAUTH_KV.put(name, JSON.stringify({ ...record, expiresAt: 1 }));
    }
    expect(keys.keys.length).toBeGreaterThan(0);
    const response = await mcp(accessToken, "tools/list");
    expect(response.status).toBe(401);
  });

  it("rejects a token request with no PKCE verifier or the wrong one", async () => {
    const { startAuthorization, etsyCallback } = await import("./support/oauth-flow");
    for (const verifier of [undefined, "wrong-verifier-wrong-verifier-wrong-verifier"]) {
      const redirect = await startAuthorization();
      const callback = await etsyCallback(redirect);
      const code = new URL(callback.headers.get("location") ?? "").searchParams.get("code") ?? "";
      const response = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: CLAUDE_REDIRECT,
        client_id: redirect.clientId,
        resource: `${ORIGIN}/mcp`,
        ...(verifier === undefined ? {} : { code_verifier: verifier }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("refuses to issue a token for another resource", async () => {
    const { startAuthorization, etsyCallback } = await import("./support/oauth-flow");
    const redirect = await startAuthorization();
    const callback = await etsyCallback(redirect);
    const code = new URL(callback.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const response = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: redirect.clientId,
      code_verifier: redirect.verifier,
      resource: "https://other.example/mcp",
    });
    expect(response.status).toBe(400);
  });

  it("issues a token for /mcp that the endpoint accepts", async () => {
    const { accessToken } = await connect();
    const response = await mcp(accessToken, "tools/list");
    expect(response.status).toBe(200);
  });
});
