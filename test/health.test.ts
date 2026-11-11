import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await exports.default.fetch("https://worker.test/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ok: true });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await exports.default.fetch("https://worker.test/nope");
    expect(response.status).toBe(404);
  });

  it("returns 404 for non-GET health requests", async () => {
    const response = await exports.default.fetch("https://worker.test/health", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
