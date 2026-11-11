import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { mockEtsy } from "./support/etsy-mock";
import {
  authorizationCode,
  call,
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  CLAUDE_SECRET,
  connect,
  mcp,
  ORIGIN,
  tokenRequest,
} from "./support/oauth-flow";

// These pin the behaviour of the exactly pinned @cloudflare/workers-oauth-provider
// version as this Worker configures it, rather than assuming it.

beforeEach(() => {
  mockEtsy();
});

describe("discovery", () => {
  it("serves authorization-server metadata with PKCE S256 and no registration endpoint", async () => {
    const response = await call("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    const metadata = await response.json<Record<string, unknown>>();
    expect(metadata["code_challenge_methods_supported"]).toContain("S256");
    expect(metadata).not.toHaveProperty("registration_endpoint");
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

  it("has no registration endpoint for an app to add itself", async () => {
    const response = await call("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "x", redirect_uris: ["https://evil.example/cb"] }),
    });
    expect(response.status).toBe(404);
    expect(await env.OAUTH_KV.list({ prefix: "client:" })).toMatchObject({ keys: [] });
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
    for (const verifier of [undefined, "wrong-verifier-wrong-verifier-wrong-verifier"]) {
      const { code } = await authorizationCode();
      const response = await tokenRequest(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: CLAUDE_REDIRECT,
          resource: `${ORIGIN}/mcp`,
          ...(verifier === undefined ? {} : { code_verifier: verifier }),
        },
        [CLAUDE_ID, CLAUDE_SECRET],
      );
      expect(response.status).toBe(400);
    }
  });

  it("refuses to issue a token for another resource", async () => {
    const { code, verifier } = await authorizationCode();
    const response = await tokenRequest(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: CLAUDE_REDIRECT,
        code_verifier: verifier,
        resource: "https://other.example/mcp",
      },
      [CLAUDE_ID, CLAUDE_SECRET],
    );
    expect(response.status).toBe(400);
  });

  it("issues a token for /mcp that the endpoint accepts", async () => {
    const { accessToken } = await connect();
    const response = await mcp(accessToken, "tools/list");
    expect(response.status).toBe(200);
  });

  it("refreshes with the client secret", async () => {
    const { refreshToken } = await connect();
    const response = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, [
      CLAUDE_ID,
      CLAUDE_SECRET,
    ]);
    expect(response.status).toBe(200);
    const { access_token: accessToken } = await response.json<{ access_token: string }>();
    expect((await mcp(accessToken, "tools/list")).status).toBe(200);
  });
});
