import { reset } from "cloudflare:test";
import { afterEach, vi } from "vitest";

// Every test starts with empty KV and Durable Object storage and no leftover mocks.
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
