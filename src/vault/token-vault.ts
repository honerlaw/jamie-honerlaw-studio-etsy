import { z } from "zod";

import type { EtsyTokens, TokenOutcome } from "../etsy/request-etsy-token";
import type { KeyRing } from "./key-ring";
import { seal } from "./seal";
import { unseal } from "./unseal";
import type { VaultStorage } from "./vault-storage";

export type AccessResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly reason: "not_connected" | "reconnect" | "unavailable" };

export interface VaultStatus {
  readonly connected: boolean;
  readonly obtainedAt: number | null;
}

export interface VaultDeps {
  readonly storage: VaultStorage;
  readonly keyRing: () => Promise<KeyRing>;
  // The shop id: bound into every record as AES-GCM additional data.
  readonly aad: string;
  readonly refresh: (refreshToken: string) => Promise<TokenOutcome>;
  readonly now: () => number;
}

const RECORD = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  obtainedAt: z.number(),
});
type TokenRecord = z.infer<typeof RECORD>;

// Refresh when less than this much access-token life is left.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Holds her Etsy tokens, sealed, and hands out a live access token. Concurrent callers
// share one in-flight refresh: a Durable Object's input gate does not cover an outbound
// fetch, so without the shared promise two callers could each rotate the refresh token
// and one rotation would be lost.
export class TokenVault {
  private inflight: Promise<AccessResult> | undefined;

  constructor(private readonly deps: VaultDeps) {}

  async store(tokens: EtsyTokens): Promise<void> {
    await this.write(this.toRecord(tokens));
  }

  async status(): Promise<VaultStatus> {
    const record = await this.read();
    return record === "missing" || record === "unreadable"
      ? { connected: false, obtainedAt: null }
      : { connected: true, obtainedAt: record.obtainedAt };
  }

  async clear(): Promise<void> {
    await this.deps.storage.delete();
  }

  async getAccessToken(): Promise<AccessResult> {
    const record = await this.read();
    if (record === "missing") {
      return { ok: false, reason: "not_connected" };
    }
    if (record === "unreadable") {
      await this.deps.storage.delete();
      return { ok: false, reason: "reconnect" };
    }
    if (this.isFresh(record)) {
      return { ok: true, accessToken: record.accessToken };
    }
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async refresh(): Promise<AccessResult> {
    // Re-read after the await: another caller may have refreshed or cleared meanwhile.
    const record = await this.read();
    if (record === "missing" || record === "unreadable") {
      return { ok: false, reason: "reconnect" };
    }
    if (this.isFresh(record)) {
      return { ok: true, accessToken: record.accessToken };
    }
    const outcome = await this.deps.refresh(record.refreshToken);
    if (outcome.kind === "invalid_grant") {
      await this.deps.storage.delete();
      return { ok: false, reason: "reconnect" };
    }
    if (outcome.kind === "unavailable") {
      return { ok: false, reason: "unavailable" };
    }
    const next = this.toRecord(outcome.tokens);
    try {
      // One write holds both the new access token and the rotated refresh token.
      await this.write(next);
    } catch {
      // Etsy has already rotated, so the stored refresh token is now dead. The next call
      // gets invalid_grant from Etsy and takes the reconnect path: never a half-write.
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, accessToken: next.accessToken };
  }

  private isFresh(record: TokenRecord): boolean {
    return record.accessExpiresAt - this.deps.now() > REFRESH_MARGIN_MS;
  }

  private toRecord(tokens: EtsyTokens): TokenRecord {
    const now = this.deps.now();
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: now + tokens.expiresInSeconds * 1000,
      obtainedAt: now,
    };
  }

  private async write(record: TokenRecord): Promise<void> {
    const ring = await this.deps.keyRing();
    await this.deps.storage.put(await seal(ring, this.deps.aad, JSON.stringify(record)));
  }

  // "unreadable" covers a lost key and a corrupt record: either way she reconnects.
  private async read(): Promise<TokenRecord | "missing" | "unreadable"> {
    const sealed = await this.deps.storage.get();
    if (sealed === undefined) {
      return "missing";
    }
    const ring = await this.deps.keyRing();
    let opened;
    try {
      opened = await unseal(ring, this.deps.aad, sealed);
    } catch {
      return "unreadable";
    }
    const parsed = RECORD.safeParse(JSON.parse(opened.plaintext));
    if (!parsed.success) {
      return "unreadable";
    }
    if (opened.kid !== ring.currentKid) {
      // Key rotation: re-seal under the current key. Best effort; the old key still works.
      await this.write(parsed.data).catch(() => undefined);
    }
    return parsed.data;
  }
}
