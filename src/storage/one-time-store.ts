import { DurableObject } from "cloudflare:workers";

interface Entry {
  readonly value: string;
  readonly expiresAt: number;
}

// Single-use values with a time limit: OAuth `state`, upload nonces and confirmation
// tokens. KV can't do this safely, because it is eventually consistent and has no
// compare-and-swap. A Durable Object runs one event at a time and its synchronous
// storage calls never yield, so `consume` reads and deletes in one uninterruptible step.
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
    const entry = this.ctx.storage.kv.get<Entry>(key);
    if (entry === undefined) {
      return null;
    }
    this.ctx.storage.kv.delete(key);
    return entry.expiresAt > Date.now() ? entry.value : null;
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
}
