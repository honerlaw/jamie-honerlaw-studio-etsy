import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { ETSY_SUBREQUESTS } from "../src/etsy/etsy-subrequest-budget";
import { buildShopToolDeps } from "../src/mcp/build-shop-tool-deps";
import { mockEtsy } from "./support/etsy-mock";

it("gives every Etsy client in one request the same subrequest budget", async () => {
  const etsy = mockEtsy();
  const deps = buildShopToolDeps(env, {} as OAuthHelpers, { etsyUserId: "1001", shopId: "2002", origin: "https://x" });
  const first = deps.etsy("a");
  const second = deps.etsy("b");
  for (let call = 0; call < ETSY_SUBREQUESTS; call += 1) {
    const { response } = await (call % 2 === 0 ? first : second).GET("/v3/application/shops/{shop_id}", {
      params: { path: { shop_id: 2002 } },
    });
    expect(response.ok).toBe(true);
  }
  const { response } = await deps.etsy("c").GET("/v3/application/shops/{shop_id}", {
    params: { path: { shop_id: 2002 } },
  });
  expect(response.statusText).toBe("Subrequest budget spent");
  expect(etsy.reads()).toHaveLength(ETSY_SUBREQUESTS);
});
