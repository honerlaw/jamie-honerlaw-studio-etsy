import { describe, expect, it } from "vitest";

import { base64url } from "../src/vault/base64url";
import { fromBase64url } from "../src/vault/from-base64url";
import { parseKeyRing } from "../src/vault/key-ring";
import { seal } from "../src/vault/seal";
import { unseal } from "../src/vault/unseal";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("parseKeyRing", () => {
  it.each([
    ["invalid JSON", "{", "k"],
    ["a non-base64 key", JSON.stringify({ k: "!!" }), "k"],
    ["a 16-byte key", JSON.stringify({ k: btoa("x".repeat(16)) }), "k"],
    ["a bad key id", JSON.stringify({ "bad kid": KEY }), "bad kid"],
    ["a current kid that isn't listed", JSON.stringify({ k: KEY }), "other"],
  ])("rejects %s", async (_case, json, kid) => {
    await expect(parseKeyRing(json, kid)).rejects.toThrow();
  });
});

describe("seal and unseal", () => {
  it("round-trips and uses a fresh IV every time", async () => {
    const ring = await parseKeyRing(JSON.stringify({ k: KEY }), "k");
    const first = await seal(ring, "shop", "secret");
    const second = await seal(ring, "shop", "secret");
    expect(first).not.toBe(second);
    expect(await unseal(ring, "shop", first)).toStrictEqual({ plaintext: "secret", kid: "k" });
  });

  it("refuses a record moved to another shop (AAD mismatch)", async () => {
    const ring = await parseKeyRing(JSON.stringify({ k: KEY }), "k");
    await expect(unseal(ring, "other-shop", await seal(ring, "shop", "secret"))).rejects.toThrow();
  });

  it.each(["k.only-two", "k.a.b.c", "zz.AAAA.AAAA"])("refuses malformed or unknown-key record %s", async (sealed) => {
    const ring = await parseKeyRing(JSON.stringify({ k: KEY }), "k");
    await expect(unseal(ring, "shop", sealed)).rejects.toThrow();
  });

  it("seal fails if the current key is missing from the ring", async () => {
    await expect(seal({ currentKid: "gone", keys: new Map() }, "shop", "x")).rejects.toThrow(TypeError);
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, index) => (index * 37) % 256);
    expect(fromBase64url(base64url(bytes))).toStrictEqual(bytes);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => fromBase64url("a+b/")).toThrow(TypeError);
  });
});
