import type { EtsyClient } from "../etsy/create-etsy-client";
import type { AccessResult, VaultStatus } from "../vault/token-vault";

// What a tool may touch. Built per request by the MCP handler; tests build fakes.
export interface ShopToolDeps {
  readonly shopId: string;
  readonly getAccessToken: () => Promise<AccessResult>;
  readonly vaultStatus: () => Promise<VaultStatus>;
  readonly etsy: (accessToken: string) => EtsyClient;
  readonly readCronStatus: () => Promise<string | null>;
  // Called when the Etsy connection is gone for good: revokes her MCP grants.
  readonly revokeGrants: () => Promise<void>;
}
