import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { ensureClients } from "../src/auth/ensure-clients";
import { handleRequest } from "../src/auth/handle-request";
import { parseMcpClients } from "../src/auth/mcp-clients";
import { providerOptions } from "../src/auth/provider-options";
import { requestedClientId } from "../src/auth/requested-client-id";
import { mockEtsy } from "./support/etsy-mock";
import {
  authorizationCode,
  basicAuth,
  call,
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  CLAUDE_SECRET,
  connect,
  mcp,
  ORIGIN,
  tokenRequest,
} from "./support/oauth-flow";

// The closed client list: only the apps in MCP_CLIENTS can start a sign-in or get a token.

beforeEach(() => {
  mockEtsy();
});

function withEnv(path: string, overrides: Partial<Env>, init?: RequestInit): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init });
  return handleRequest(request, { ...env, ...overrides }, createExecutionContext());
}

function authorizeQuery(clientId: string, redirectUri = CLAUDE_REDIRECT): string {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: "s",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
  }).toString();
}

const SECRET = "a-long-secret-a-long-secret-a-long-secret";
const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "claude",
  name: "Claude",
  secret: SECRET,
  redirectUris: [CLAUDE_REDIRECT],
  ...overrides,
});

describe("parseMcpClients", () => {
  it("accepts a well-formed list", () => {
    expect(parseMcpClients(JSON.stringify([entry()]))).toHaveLength(1);
  });

  it.each([
    ["not JSON", `[{"secret":"${SECRET}"`],
    ["an empty list", "[]"],
    ["a short secret", JSON.stringify([entry({ secret: "short" })])],
    ["an http redirect URI", JSON.stringify([entry({ redirectUris: ["http://claude.ai/cb"] })])],
    ["no redirect URIs", JSON.stringify([entry({ redirectUris: [] })])],
    ["an id with odd characters", JSON.stringify([entry({ id: "Claude App" })])],
    ["a duplicate id", JSON.stringify([entry(), entry()])],
  ])("rejects %s with a fixed message that never quotes the secret", (_case, json) => {
    expect(() => parseMcpClients(json)).toThrow(TypeError);
    try {
      parseMcpClients(json);
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
    }
  });
});

describe("a missing or malformed MCP_CLIENTS", () => {
  it.each([
    ["unset", ""],
    ["malformed", `[{"secret":"${SECRET}"`],
  ])("fails closed (%s) with a 503 that echoes nothing, but /health still answers", async (_case, value) => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const path of ["/authorize", "/token", "/mcp", "/.well-known/oauth-authorization-server"]) {
      const response = await withEnv(path, { MCP_CLIENTS: value });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(SECRET);
    }
    expect((await withEnv("/health", { MCP_CLIENTS: value })).status).toBe(200);
    expect(spy).toHaveBeenCalledWith('{"event":"config_invalid","reason":"mcp_clients"}');
  });
});

describe("/authorize", () => {
  it("sends a listed client straight to Etsy, with no consent page", async () => {
    const response = await call(`/authorize?${authorizeQuery(CLAUDE_ID)}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/^https:\/\/www\.etsy\.com\/oauth\/connect\?/u);
  });

  it("refuses a client that isn't on the list, without redirecting", async () => {
    const response = await call(`/authorize?${authorizeQuery("someone-else")}`);
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await env.OAUTH_KV.get("client:someone-else")).toBeNull();
  });

  it("refuses a listed client asking to send the code somewhere else", async () => {
    const response = await call(`/authorize?${authorizeQuery(CLAUDE_ID, "https://evil.example/cb")}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows only GET", async () => {
    const response = await call(`/authorize?${authorizeQuery(CLAUDE_ID)}`, { method: "POST" });
    expect(response.status).toBe(405);
  });
});

describe("/token", () => {
  async function exchange(credentials: readonly [string, string] | undefined, extra: Record<string, string> = {}) {
    const { code, verifier } = await authorizationCode();
    return tokenRequest(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: CLAUDE_REDIRECT,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
        ...extra,
      },
      credentials,
    );
  }

  it("refuses the right code with the wrong secret", async () => {
    const response = await exchange([CLAUDE_ID, "wrong-secret-wrong-secret-wrong-secret"]);
    expect(response.status).toBe(401);
    expect(await response.json<{ error: string }>()).toMatchObject({ error: "invalid_client" });
  });

  it("refuses the right code with no secret at all", async () => {
    const response = await exchange(undefined, { client_id: CLAUDE_ID });
    expect(response.status).toBe(401);
  });

  it("refuses a client that isn't on the list", async () => {
    const response = await exchange(["someone-else", CLAUDE_SECRET]);
    expect(response.status).toBe(401);
  });

  it("accepts the secret in the form body too", async () => {
    const response = await exchange(undefined, { client_id: CLAUDE_ID, client_secret: CLAUDE_SECRET });
    expect(response.status).toBe(200);
  });
});

describe("removing a client from the list", () => {
  it("cuts off that app's existing tokens at once", async () => {
    const { accessToken } = await connect();
    const chatgptOnly = JSON.stringify(parseMcpClients(env.MCP_CLIENTS).filter((client) => client.id !== CLAUDE_ID));
    const response = await withEnv(
      "/mcp",
      { MCP_CLIENTS: chatgptOnly },
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      },
    );
    expect(response.status).toBe(401);
    expect((await mcp(accessToken, "tools/list")).status).toBe(200);
  });
});

describe("ensureClients", () => {
  const clients = parseMcpClients(JSON.stringify([entry({ id: "rotating" })]));
  const oauth = () => getOAuthApi(providerOptions(ORIGIN, clients), env);

  it("creates the record once and skips unchanged clients", async () => {
    await ensureClients(oauth(), env, clients);
    const first = await env.OAUTH_KV.get("client:rotating");
    expect(first).not.toContain(SECRET);
    await ensureClients(oauth(), env, clients);
    expect(await env.OAUTH_KV.get("client:rotating")).toBe(first);
    expect(await oauth().lookupClient("rotating")).toMatchObject({
      clientName: "Claude",
      redirectUris: [CLAUDE_REDIRECT],
    });
  });

  it("rotates the secret when the list changes", async () => {
    await ensureClients(oauth(), env, clients);
    const before = await env.OAUTH_KV.get<{ clientSecret: string }>("client:rotating", "json");
    const rotated = parseMcpClients(JSON.stringify([entry({ id: "rotating", secret: `${SECRET}-2` })]));
    await ensureClients(oauth(), env, rotated);
    const after = await env.OAUTH_KV.get<{ clientSecret: string }>("client:rotating", "json");
    expect(after?.clientSecret).not.toBe(before?.clientSecret);
  });
});

describe("requestedClientId", () => {
  const token = (init: RequestInit) => new Request(`${ORIGIN}/token`, { method: "POST", ...init });

  it("reads Basic credentials, a form body, or nothing", async () => {
    expect(await requestedClientId(token({ headers: { authorization: basicAuth("a%20b", "s") } }))).toBe("a b");
    expect(await requestedClientId(token({ headers: { authorization: "Basic !!!" } }))).toBeUndefined();
    expect(await requestedClientId(token({ headers: { authorization: basicAuth("", "s") } }))).toBeUndefined();
    expect(
      await requestedClientId(
        token({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: "client_id=x" }),
      ),
    ).toBe("x");
    expect(
      await requestedClientId(token({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" })),
    ).toBeUndefined();
    expect(
      await requestedClientId(token({ headers: { "content-type": "application/json" }, body: "{}" })),
    ).toBeUndefined();
    expect(await requestedClientId(new Request(`${ORIGIN}/authorize`))).toBeUndefined();
  });
});
