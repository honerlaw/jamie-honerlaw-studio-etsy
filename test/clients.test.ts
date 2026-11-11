import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureClients } from "../src/auth/ensure-clients";
import { handleRequest } from "../src/auth/handle-request";
import { parseMcpClients } from "../src/auth/mcp-clients";
import { requestedClientIds } from "../src/auth/requested-client-ids";
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
    ["a redirect URI with a fragment", JSON.stringify([entry({ redirectUris: [`${CLAUDE_REDIRECT}#`] })])],
    ["a redirect URI with user info", JSON.stringify([entry({ redirectUris: ["https://user@claude.ai/cb"] })])],
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

  it("writes the record once, hashes the secret, and skips an unchanged client", async () => {
    await ensureClients(env, clients);
    const first = await env.OAUTH_KV.get("client:rotating");
    expect(first).not.toBeNull();
    expect(first).not.toContain(SECRET);
    const put = vi.spyOn(env.OAUTH_KV, "put");
    await ensureClients(env, clients);
    expect(put).not.toHaveBeenCalled();
  });

  it("rewrites the record when the secret, name or redirect URIs change", async () => {
    await ensureClients(env, clients);
    const before = await env.OAUTH_KV.get<{ clientSecret: string }>("client:rotating", "json");
    await ensureClients(env, parseMcpClients(JSON.stringify([entry({ id: "rotating", secret: `${SECRET}-2` })])));
    const after = await env.OAUTH_KV.get<{ clientSecret: string }>("client:rotating", "json");
    expect(after?.clientSecret).not.toBe(before?.clientSecret);
    await ensureClients(env, parseMcpClients(JSON.stringify([entry({ id: "rotating", name: "Renamed" })])));
    expect(await env.OAUTH_KV.get("client:rotating", "json")).toMatchObject({ clientName: "Renamed" });
  });

  it("repairs a lost client record on the next sign-in", async () => {
    await connect();
    await env.OAUTH_KV.delete(`client:${CLAUDE_ID}`);
    const { accessToken } = await connect();
    expect((await mcp(accessToken, "tools/list")).status).toBe(200);
  });

  it("provisions every listed client, so ChatGPT's secret authenticates too", async () => {
    await call(`/authorize?${authorizeQuery(CLAUDE_ID)}`);
    const chatgpt = parseMcpClients(env.MCP_CLIENTS).find((client) => client.id === "chatgpt");
    const response = await tokenRequest({ grant_type: "authorization_code", code: "not-a-code" }, [
      "chatgpt",
      chatgpt?.secret ?? "",
    ]);
    expect(response.status).toBe(400);
    expect(await response.json<{ error: string }>()).toMatchObject({ error: "invalid_grant" });
  });

  it("fails closed with a 503 when the records can't be written", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const broken = {
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error("429 too many writes")),
    } as unknown as KVNamespace;
    const response = await withEnv(`/authorize?${authorizeQuery(CLAUDE_ID)}`, { OAUTH_KV: broken });
    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalledWith('{"event":"config_invalid","reason":"client_sync"}');
  });
});

describe("requestedClientIds", () => {
  const form = { "content-type": "application/x-www-form-urlencoded" };
  const token = (headers: Record<string, string>, body?: string) =>
    requestedClientIds(new Request(`${ORIGIN}/token`, { method: "POST", headers, body: body ?? null }));

  it("reads Basic credentials the way the library does", async () => {
    expect(await token({ authorization: basicAuth("a%20b+c", "s") })).toStrictEqual(["a b c"]);
    expect(await token({ authorization: `bAsIc\t${btoa("x:s")}` })).toStrictEqual(["x"]);
    expect(await token({ authorization: "Basic !!!" })).toStrictEqual([""]);
    expect(await token({ authorization: "Basic" })).toStrictEqual([""]);
    expect(await token({ authorization: `Basic ${btoa("no-separator")}` })).toStrictEqual([""]);
    expect(await token({ authorization: `Basic ${btoa("a:s")} extra` })).toStrictEqual([""]);
    expect(await token({ authorization: "Bearer abc" })).toStrictEqual([]);
  });

  it("doesn't treat a non-space separator as Basic, and still checks the body", async () => {
    const ids = await token({ ...form, authorization: `Basic\u00a0${btoa(`${CLAUDE_ID}:s`)}` }, "client_id=removed");
    expect(ids).toStrictEqual(["removed"]);
  });

  it("collects every non-empty client_id in a form body, whatever the content-type case", async () => {
    expect(await token(form, "client_id=&client_id=x&client_id=y")).toStrictEqual(["x", "y"]);
    expect(
      await token({ "content-type": " Application/X-WWW-Form-Urlencoded; charset=utf-8" }, "client_id=x"),
    ).toStrictEqual(["x"]);
    expect(await token({ "content-type": "application/json" }, "{}")).toStrictEqual([]);
    expect(await token({})).toStrictEqual([]);
  });

  it("reads every client_id on /authorize", async () => {
    const ids = await requestedClientIds(new Request(`${ORIGIN}/authorize?client_id=a&client_id=b`));
    expect(ids).toStrictEqual(["a", "b"]);
  });
});

describe("the gate end to end", () => {
  it("refuses an unlisted client_id in a /token form body", async () => {
    const response = await tokenRequest({ grant_type: "refresh_token", refresh_token: "x", client_id: "removed" });
    expect(response.status).toBe(401);
  });

  it("refuses a listed and an unlisted client_id together", async () => {
    const response = await call(`/authorize?${authorizeQuery(CLAUDE_ID)}&client_id=someone-else`);
    expect(response.status).toBe(401);
  });

  it("refuses a /token request that names no client", async () => {
    expect((await tokenRequest({ grant_type: "refresh_token", refresh_token: "x" })).status).toBe(401);
  });
});
