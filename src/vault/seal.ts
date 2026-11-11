import { base64url } from "./base64url";
import type { KeyRing } from "./key-ring";

// AES-256-GCM under the ring's current key, a fresh 12-byte IV per call, and `aad`
// (the shop id) as additional authenticated data, so a record can't be moved to another
// shop. Output: `<kid>.<iv>.<ciphertext>`, so the key can rotate.
export async function seal(ring: KeyRing, aad: string, plaintext: string): Promise<string> {
  const key = ring.keys.get(ring.currentKid);
  if (key === undefined) {
    throw new TypeError("current key missing from key ring");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return `${ring.currentKid}.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
