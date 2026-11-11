import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { oneTimeStoreStub } from "../auth/one-time-store-stub";
import { revokeUserGrants } from "../auth/revoke-user-grants";
import { createEtsyClient } from "../etsy/create-etsy-client";
import { etsyApiKey } from "../etsy/etsy-api-key";
import { sleep } from "../etsy/sleep";
import type { ShopToolDeps } from "../tools/shop-tool-deps";

// The real dependencies for one MCP request, for the allowlisted user and shop.
export function buildShopToolDeps(
  env: Env,
  oauth: OAuthHelpers,
  grant: { readonly etsyUserId: string; readonly shopId: string; readonly origin: string },
): ShopToolDeps {
  const vault = env.ETSY_TOKEN_VAULT.getByName(grant.shopId);
  const apiKey = etsyApiKey(env);
  return {
    shopId: grant.shopId,
    origin: grant.origin,
    getAccessToken: () => vault.getAccessToken(),
    vaultStatus: () => vault.status(),
    etsy: (accessToken) => createEtsyClient({ apiKey, accessToken, fetch: (r) => fetch(r), sleep }),
    readCronStatus: () => env.SHOP_KV.get("cron:last-run"),
    readViewsSnapshot: (day) => env.SHOP_KV.get(`views:${day}`),
    store: oneTimeStoreStub(env),
    uploads: env.UPLOADS,
    uploadSigningKey: env.UPLOAD_SIGNING_KEY,
    fetchFile: (url) => fetch(url, { redirect: "follow" }),
    revokeGrants: async () => {
      await revokeUserGrants(oauth, grant.etsyUserId);
    },
  };
}
