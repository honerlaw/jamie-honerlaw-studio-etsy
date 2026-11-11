import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { EtsyTokenVault } from "../src/vault/etsy-token-vault";
import { mockEtsy, TOKEN_ROUTE } from "./support/etsy-mock";

const stub = () => env.ETSY_TOKEN_VAULT.getByName("2002");

describe("EtsyTokenVault (Durable Object)", () => {
  it("refreshes an expiring token through Etsy with the refresh_token grant", async () => {
    const etsy = mockEtsy();
    await stub().store({ accessToken: "a0", refreshToken: "r0", expiresInSeconds: 1 });
    const result = await stub().getAccessToken();
    expect(result.ok).toBe(true);
    const [request] = etsy.requests;
    expect(request?.headers.get("x-api-key")).toBe("test-keystring:test-shared-secret");
    const form = new URLSearchParams(request?.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("r0");
    expect(form.get("client_id")).toBe("test-keystring");
  });

  it("clears itself when Etsy answers invalid_grant", async () => {
    const etsy = mockEtsy();
    etsy.routes.set(TOKEN_ROUTE, () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await stub().store({ accessToken: "a0", refreshToken: "r0", expiresInSeconds: 1 });
    expect(await stub().getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
    expect((await stub().status()).connected).toBe(false);
  });

  it("clear() removes the record", async () => {
    await stub().store({ accessToken: "a0", refreshToken: "r0", expiresInSeconds: 3600 });
    await stub().clear();
    expect((await stub().status()).connected).toBe(false);
  });

  it("fails loudly on a bad key secret, and retries parsing on the next call", async () => {
    await runInDurableObject(stub(), async (_instance, state) => {
      const broken = new EtsyTokenVault(state, { ...env, TOKEN_ENC_KEYS: "not json" });
      await expect(broken.store({ accessToken: "a", refreshToken: "r", expiresInSeconds: 3600 })).rejects.toThrow();
      await expect(broken.status()).resolves.toStrictEqual({ connected: false, obtainedAt: null });
      await expect(broken.store({ accessToken: "a", refreshToken: "r", expiresInSeconds: 3600 })).rejects.toThrow();
    });
  });
});
