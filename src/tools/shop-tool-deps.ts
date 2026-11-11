import type { EtsyClient } from "../etsy/create-etsy-client";
import type { Claimed, PeekResult } from "../storage/one-time-store";
import type { AccessResult, VaultStatus } from "../vault/token-vault";

// The OneTimeStore operations tools use (confirmation tokens and upload sessions).
export interface OneTimeStoreApi {
  put(key: string, value: string, ttlMs: number): Promise<void>;
  consume(key: string): Promise<string | null>;
  peek(key: string): Promise<PeekResult | null>;
  claim(key: string, leaseMs: number): Promise<Claimed | null>;
  update(key: string, lease: string, value: string): Promise<boolean>;
  finish(key: string, lease: string): Promise<boolean>;
  release(key: string, lease: string): Promise<void>;
}

// What a tool may touch. Built per request by the MCP handler; tests build fakes.
export interface ShopToolDeps {
  readonly shopId: string;
  // This server's origin, for the photo upload links it hands out.
  readonly origin: string;
  readonly getAccessToken: () => Promise<AccessResult>;
  readonly vaultStatus: () => Promise<VaultStatus>;
  readonly etsy: (accessToken: string) => EtsyClient;
  readonly readCronStatus: () => Promise<string | null>;
  // One daily views snapshot (`views:YYYY-MM-DD`), or null when that day has none.
  readonly readViewsSnapshot: (day: string) => Promise<string | null>;
  readonly store: OneTimeStoreApi;
  // Staged photo uploads, under `uploads/<nonce>/`.
  readonly uploads: R2Bucket;
  readonly uploadSigningKey: string;
  // Fetches a file a client handed over by URL (ChatGPT's file params).
  readonly fetchFile: (url: string) => Promise<Response>;
  // Called when the Etsy connection is gone for good: revokes her MCP grants.
  readonly revokeGrants: () => Promise<void>;
}
