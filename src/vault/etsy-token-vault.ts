import { DurableObject } from "cloudflare:workers";

import { etsyApiKey } from "../etsy/etsy-api-key";
import { requestEtsyToken, type EtsyTokens } from "../etsy/request-etsy-token";
import { parseKeyRing, type KeyRing } from "./key-ring";
import { TokenVault, type AccessResult, type VaultStatus } from "./token-vault";

const RECORD_KEY = "record";

// One instance, named by the allowlisted shop id, holds her sealed Etsy tokens. Every
// method is an RPC entry point; the logic lives in TokenVault so it can be unit-tested
// with injected storage, keys and clock.
export class EtsyTokenVault extends DurableObject<Env> {
  private readonly vault: TokenVault;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    let ring: Promise<KeyRing> | undefined;
    const loadRing = (): Promise<KeyRing> =>
      (ring ??= parseKeyRing(env.TOKEN_ENC_KEYS, env.TOKEN_ENC_KID).catch((error: unknown) => {
        ring = undefined;
        throw error;
      }));
    this.vault = new TokenVault({
      storage: {
        get: () => ctx.storage.get<string>(RECORD_KEY),
        put: (sealed) => ctx.storage.put(RECORD_KEY, sealed),
        delete: async () => {
          await ctx.storage.delete(RECORD_KEY);
        },
      },
      keyRing: loadRing,
      aad: env.ALLOWED_ETSY_SHOP_ID,
      refresh: (refreshToken) =>
        requestEtsyToken((input, init) => fetch(input, init), etsyApiKey(env), {
          grant_type: "refresh_token",
          client_id: env.ETSY_KEYSTRING,
          refresh_token: refreshToken,
        }),
      now: () => Date.now(),
    });
  }

  store(tokens: EtsyTokens): Promise<void> {
    return this.vault.store(tokens);
  }

  getAccessToken(): Promise<AccessResult> {
    return this.vault.getAccessToken();
  }

  status(): Promise<VaultStatus> {
    return this.vault.status();
  }

  clear(): Promise<void> {
    return this.vault.clear();
  }
}
