import { describe, expect, it } from "vitest";

import type { TokenOutcome } from "../src/etsy/request-etsy-token";
import { parseKeyRing, type KeyRing } from "../src/vault/key-ring";
import { seal } from "../src/vault/seal";
import { TokenVault } from "../src/vault/token-vault";
import type { VaultStorage } from "../src/vault/vault-storage";

const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
const HOUR = 3600;

class MemoryStorage implements VaultStorage {
  value: string | undefined;
  failPuts = false;
  puts = 0;

  get(): Promise<string | undefined> {
    return Promise.resolve(this.value);
  }

  put(sealed: string): Promise<void> {
    if (this.failPuts) {
      return Promise.reject(new Error("storage down"));
    }
    this.puts += 1;
    this.value = sealed;
    return Promise.resolve();
  }

  delete(): Promise<void> {
    this.value = undefined;
    return Promise.resolve();
  }
}

interface Harness {
  readonly vault: TokenVault;
  readonly storage: MemoryStorage;
  readonly refreshes: string[];
  clock: number;
  outcome: () => Promise<TokenOutcome>;
}

let rotation = 0;
function rotated(): TokenOutcome {
  rotation += 1;
  return {
    kind: "ok",
    tokens: {
      accessToken: `access-r${String(rotation)}`,
      refreshToken: `refresh-r${String(rotation)}`,
      expiresInSeconds: HOUR,
    },
  };
}

async function harness(ring?: KeyRing): Promise<Harness> {
  const keyRing = ring ?? (await parseKeyRing(JSON.stringify({ a: KEY_A }), "a"));
  const storage = new MemoryStorage();
  const state: Harness = {
    storage,
    refreshes: [],
    clock: 1_000_000,
    outcome: () => Promise.resolve(rotated()),
    vault: undefined as unknown as TokenVault,
  };
  Object.assign(state, {
    vault: new TokenVault({
      storage,
      keyRing: () => Promise.resolve(keyRing),
      aad: "2002",
      refresh: (refreshToken) => {
        state.refreshes.push(refreshToken);
        return state.outcome();
      },
      now: () => state.clock,
    }),
  });
  return state;
}

const INITIAL = { accessToken: "access-0", refreshToken: "refresh-0", expiresInSeconds: HOUR };

describe("TokenVault", () => {
  it("reports not connected before anything is stored", async () => {
    const { vault } = await harness();
    expect(await vault.getAccessToken()).toStrictEqual({ ok: false, reason: "not_connected" });
    expect(await vault.status()).toStrictEqual({ connected: false, obtainedAt: null });
  });

  it("returns the stored token while it is fresh, without refreshing", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: true, accessToken: "access-0" });
    expect(h.refreshes).toHaveLength(0);
    expect(await h.vault.status()).toStrictEqual({ connected: true, obtainedAt: 1_000_000 });
  });

  it("never stores either token in plaintext", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    expect(h.storage.value).toBeDefined();
    expect(h.storage.value).not.toContain("access-0");
    expect(h.storage.value).not.toContain("refresh-0");
    expect(h.storage.value?.startsWith("a.")).toBe(true);
  });

  it("refreshes exactly once for many concurrent callers, and persists the rotated token", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    h.clock += (HOUR - 60) * 1000; // under the 5-minute margin
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.outcome = async () => {
      await gate;
      return rotated();
    };
    const callers = Array.from({ length: 10 }, () => h.vault.getAccessToken());
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const results = await Promise.all(callers);
    expect(h.refreshes).toStrictEqual(["refresh-0"]);
    expect(results.every((result) => result.ok)).toBe(true);
    const tokens = new Set(results.map((result) => (result.ok ? result.accessToken : result.reason)));
    expect(tokens.size).toBe(1);
    // The rotated refresh token is what the next refresh uses.
    h.clock += HOUR * 1000;
    h.outcome = () => Promise.resolve(rotated());
    await h.vault.getAccessToken();
    expect(h.refreshes[1]).toMatch(/^refresh-r\d+$/u);
  });

  it("clears the record and asks for a reconnect when Etsy says invalid_grant", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    h.clock += HOUR * 1000;
    h.outcome = () => Promise.resolve({ kind: "invalid_grant" });
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
    expect(h.storage.value).toBeUndefined();
  });

  it("keeps the record when Etsy is unavailable", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    const before = h.storage.value;
    h.clock += HOUR * 1000;
    h.outcome = () => Promise.resolve({ kind: "unavailable", status: 503 });
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "unavailable" });
    expect(h.storage.value).toBe(before);
  });

  it("leaves the old record intact when the write after a refresh fails, then reconnects", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    const before = h.storage.value;
    h.clock += HOUR * 1000;
    h.storage.failPuts = true;
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "unavailable" });
    expect(h.storage.value).toBe(before);
    // Etsy already rotated, so it now refuses the old refresh token.
    h.storage.failPuts = false;
    h.outcome = () => Promise.resolve({ kind: "invalid_grant" });
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
    expect(h.storage.value).toBeUndefined();
  });

  it("decrypts a record sealed under an old key and re-seals it under the current one", async () => {
    const oldRing = await parseKeyRing(JSON.stringify({ a: KEY_A }), "a");
    const newRing = await parseKeyRing(JSON.stringify({ a: KEY_A, b: KEY_B }), "b");
    const h = await harness(newRing);
    h.storage.value = await seal(
      oldRing,
      "2002",
      JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old", accessExpiresAt: 9e15, obtainedAt: 1 }),
    );
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: true, accessToken: "access-old" });
    expect(h.storage.value.startsWith("b.")).toBe(true);
  });

  it("asks for a reconnect when the record's key is gone", async () => {
    const lost = await parseKeyRing(JSON.stringify({ z: KEY_B }), "z");
    const h = await harness();
    h.storage.value = await seal(lost, "2002", "{}");
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
    expect(h.storage.value).toBeUndefined();
  });

  it("treats a record that decrypts but has the wrong shape as unreadable", async () => {
    const ring = await parseKeyRing(JSON.stringify({ a: KEY_A }), "a");
    const h = await harness(ring);
    h.storage.value = await seal(ring, "2002", JSON.stringify({ unexpected: true }));
    expect(await h.vault.status()).toStrictEqual({ connected: false, obtainedAt: null });
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
  });

  it("asks for a reconnect if the record vanishes before the refresh starts", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    h.clock += HOUR * 1000;
    const original = h.storage.get.bind(h.storage);
    let reads = 0;
    h.storage.get = () => {
      reads += 1;
      return reads === 1 ? original() : Promise.resolve(undefined);
    };
    expect(await h.vault.getAccessToken()).toStrictEqual({ ok: false, reason: "reconnect" });
    expect(h.refreshes).toHaveLength(0);
  });

  it("clear() forgets the tokens", async () => {
    const h = await harness();
    await h.vault.store(INITIAL);
    await h.vault.clear();
    expect(await h.vault.status()).toStrictEqual({ connected: false, obtainedAt: null });
  });
});
