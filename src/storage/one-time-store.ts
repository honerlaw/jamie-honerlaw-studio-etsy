import { DurableObject } from "cloudflare:workers";

interface Entry {
  readonly value: string;
  readonly expiresAt: number;
  // While set and in the future, one caller holds an exclusive lease (see `claim`).
  readonly leaseUntil?: number;
  // Identifies that lease, so only its holder can update, finish or release the entry.
  readonly leaseId?: string;
  // The lease's length, renewed on each update by its holder.
  readonly leaseMs?: number;
}

// What `peek` reports about a live entry.
export interface PeekResult {
  readonly value: string;
  readonly leased: boolean;
}

// What `claim` hands its caller: the value, and the lease id the leased calls need.
export interface Claimed {
  readonly value: string;
  readonly lease: string;
}

// Single-use values with a time limit: OAuth `state`, confirmation tokens and photo
// upload sessions. KV can't do this safely, because it is eventually consistent and has
// no compare-and-swap. A Durable Object runs one event at a time and its synchronous
// storage calls never yield, so each method below reads and writes in one
// uninterruptible step.
export class OneTimeStore extends DurableObject {
  async put(key: string, value: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    this.ctx.storage.kv.put<Entry>(key, { value, expiresAt });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt);
    }
  }

  // Returns the value once, then null. An expired entry is deleted and never returned.
  consume(key: string): string | null {
    const entry = this.live(key);
    if (entry !== undefined) {
      this.ctx.storage.kv.delete(key);
    }
    return entry?.value ?? null;
  }

  // Reads a live entry without using it up, and says whether it is leased right now.
  peek(key: string): PeekResult | null {
    const entry = this.live(key);
    if (entry === undefined) {
      return null;
    }
    return { value: entry.value, leased: (entry.leaseUntil ?? 0) > Date.now() };
  }

  // Takes an exclusive lease for `leaseMs` and returns the value with a lease id, or null
  // when the entry is gone, expired or already leased. A lease that runs out frees
  // itself, so a caller that crashed mid-way can't lock the entry forever.
  claim(key: string, leaseMs: number): Claimed | null {
    const entry = this.live(key);
    if (entry === undefined || (entry.leaseUntil ?? 0) > Date.now()) {
      return null;
    }
    const lease = crypto.randomUUID();
    this.ctx.storage.kv.put<Entry>(key, { ...entry, leaseUntil: Date.now() + leaseMs, leaseId: lease, leaseMs });
    return { value: entry.value, lease };
  }

  // Replaces the value, keeping its expiry, but only for the lease's holder, and renews
  // the lease so a long run that keeps making progress keeps it. False when the entry is
  // gone or was replaced or re-claimed since (a `put` drops the lease), so a slow holder
  // can't overwrite a newer entry.
  update(key: string, lease: string, value: string): boolean {
    const entry = this.held(key, lease);
    if (entry === undefined) {
      return false;
    }
    this.ctx.storage.kv.put<Entry>(key, { ...entry, value, leaseUntil: Date.now() + (entry.leaseMs ?? 0) });
    return true;
  }

  // Deletes the entry for the lease's holder: the leased counterpart of `consume`.
  finish(key: string, lease: string): boolean {
    const entry = this.held(key, lease);
    if (entry !== undefined) {
      this.ctx.storage.kv.delete(key);
    }
    return entry !== undefined;
  }

  // Ends the holder's lease early so the next `claim` can proceed.
  release(key: string, lease: string): void {
    const entry = this.held(key, lease);
    if (entry !== undefined) {
      this.ctx.storage.kv.put<Entry>(key, { value: entry.value, expiresAt: entry.expiresAt });
    }
  }

  // Sweeps expired entries so abandoned ones don't pile up, then re-arms for the next.
  override async alarm(): Promise<void> {
    const now = Date.now();
    let next: number | undefined;
    for (const [key, entry] of this.ctx.storage.kv.list<Entry>()) {
      if (entry.expiresAt <= now) {
        this.ctx.storage.kv.delete(key);
      } else if (next === undefined || entry.expiresAt < next) {
        next = entry.expiresAt;
      }
    }
    if (next !== undefined) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  // The live entry if this lease (expired or not) is still the latest one taken on it.
  private held(key: string, lease: string): Entry | undefined {
    const entry = this.live(key);
    return entry?.leaseId === lease ? entry : undefined;
  }

  // The entry if it exists and hasn't expired; an expired one is deleted on sight.
  private live(key: string): Entry | undefined {
    const entry = this.ctx.storage.kv.get<Entry>(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.ctx.storage.kv.delete(key);
      return undefined;
    }
    return entry;
  }
}
