import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const stub = () => env.ONE_TIME_STORE.getByName("one-time-store");

describe("OneTimeStore", () => {
  it("returns a value once, then nothing", async () => {
    await stub().put("k", "v", 60_000);
    expect(await stub().consume("k")).toBe("v");
    expect(await stub().consume("k")).toBeNull();
  });

  it("returns nothing for a key it never had", async () => {
    expect(await stub().consume("missing")).toBeNull();
  });

  it("hands a value to exactly one of many concurrent consumers", async () => {
    await stub().put("race", "winner", 60_000);
    const results = await Promise.all(Array.from({ length: 25 }, () => stub().consume("race")));
    expect(results.filter((result) => result === "winner")).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(24);
  });

  it("never returns an expired value, and deletes it", async () => {
    await stub().put("old", "v", -1);
    expect(await stub().consume("old")).toBeNull();
    await runInDurableObject(stub(), (_instance, state) => {
      expect(state.storage.kv.get("old")).toBeUndefined();
    });
  });

  it("sweeps expired entries on its alarm and re-arms for the next one", async () => {
    await stub().put("live", "v", 60_000);
    await stub().put("dead", "v", -1);
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(state.storage.kv.get("dead")).toBeUndefined();
      expect(state.storage.kv.get("live")).toBeDefined();
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    expect(await stub().consume("live")).toBe("v");
  });

  it("does not re-arm when nothing is left", async () => {
    await stub().put("dead", "v", -1);
    await runDurableObjectAlarm(stub());
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});

describe("OneTimeStore leases (upload sessions)", () => {
  it("peeks without using the entry up", async () => {
    await stub().put("p", "v", 60_000);
    expect(await stub().peek("p")).toStrictEqual({ value: "v", leased: false });
    expect(await stub().peek("p")).toStrictEqual({ value: "v", leased: false });
    expect(await stub().peek("missing")).toBeNull();
  });

  it("grants a lease to exactly one of many concurrent claimers", async () => {
    await stub().put("lease", "v", 60_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => stub().claim("lease", 60_000)));
    expect(results.filter((result) => result?.value === "v")).toHaveLength(1);
    expect(await stub().peek("lease")).toStrictEqual({ value: "v", leased: true });
  });

  it("updates under a lease, frees it on release, and lets an expired lease be claimed again", async () => {
    await stub().put("s", "v1", 60_000);
    const first = await stub().claim("s", 60_000);
    expect(first?.value).toBe("v1");
    expect(await stub().update("s", first?.lease ?? "", "v2")).toBe(true);
    expect(await stub().peek("s")).toStrictEqual({ value: "v2", leased: true });
    await stub().release("s", first?.lease ?? "");
    const expired = await stub().claim("s", -1);
    expect(expired?.value).toBe("v2");
    const next = await stub().claim("s", 60_000);
    expect(next?.value).toBe("v2");
    expect(await stub().update("s", expired?.lease ?? "", "stale")).toBe(false);
    expect(await stub().finish("s", expired?.lease ?? "")).toBe(false);
    expect(await stub().finish("s", next?.lease ?? "")).toBe(true);
    expect(await stub().peek("s")).toBeNull();
  });

  it("refuses a holder whose entry was replaced by a put", async () => {
    await stub().put("r", "old", 60_000);
    const held = await stub().claim("r", 60_000);
    await stub().put("r", "new", 60_000);
    expect(await stub().update("r", held?.lease ?? "", "clobber")).toBe(false);
    await stub().release("r", held?.lease ?? "");
    expect(await stub().finish("r", held?.lease ?? "")).toBe(false);
    expect(await stub().peek("r")).toStrictEqual({ value: "new", leased: false });
  });

  it("does nothing for a missing or expired entry", async () => {
    expect(await stub().claim("gone", 1000)).toBeNull();
    expect(await stub().update("gone", "l", "v")).toBe(false);
    expect(await stub().finish("gone", "l")).toBe(false);
    await stub().release("gone", "l");
    await stub().put("expired", "v", -1);
    expect(await stub().peek("expired")).toBeNull();
  });
});
