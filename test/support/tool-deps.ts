import { env } from "cloudflare:workers";

import { oneTimeStoreStub } from "../../src/auth/one-time-store-stub";
import { createEtsyClient } from "../../src/etsy/create-etsy-client";
import type { ShopToolDeps } from "../../src/tools/shop-tool-deps";
import { ORIGIN } from "./oauth-flow";

// Real storage bindings and a real Etsy client (whose fetch the Etsy mock intercepts),
// with a live access token, so tool handlers can be called directly.
export function toolDeps(overrides: Partial<ShopToolDeps> = {}): ShopToolDeps & { revoked: number } {
  const deps = {
    revoked: 0,
    shopId: "2002",
    origin: ORIGIN,
    getAccessToken: () => Promise.resolve({ ok: true as const, accessToken: "1001.access" }),
    vaultStatus: () => Promise.resolve({ connected: true, obtainedAt: 0 }),
    etsy: (accessToken: string) =>
      createEtsyClient({
        apiKey: "test-keystring:test-shared-secret",
        accessToken,
        fetch: (request) => fetch(request),
        sleep: () => Promise.resolve(),
      }),
    readCronStatus: () => Promise.resolve(null),
    readViewsSnapshot: (day: string) => env.SHOP_KV.get(`views:${day}`),
    store: oneTimeStoreStub(env),
    uploads: env.UPLOADS,
    uploadSigningKey: env.UPLOAD_SIGNING_KEY,
    fetchFile: (url: string) => fetch(url),
    revokeGrants: () => {
      deps.revoked += 1;
      return Promise.resolve();
    },
    ...overrides,
  };
  return deps;
}
