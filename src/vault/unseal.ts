import { fromBase64url } from "./from-base64url";
import type { KeyRing } from "./key-ring";

export interface Unsealed {
  readonly plaintext: string;
  readonly kid: string;
}

// Opens a seal() output with whichever listed key its kid names. Throws when the kid is
// unknown (a lost or retired key), the record is malformed, or authentication fails.
export async function unseal(ring: KeyRing, aad: string, sealed: string): Promise<Unsealed> {
  const [kid, iv, ciphertext, ...rest] = sealed.split(".");
  if (kid === undefined || iv === undefined || ciphertext === undefined || rest.length > 0) {
    throw new TypeError("malformed sealed record");
  }
  const key = ring.keys.get(kid);
  if (key === undefined) {
    throw new TypeError("sealed under an unknown key id");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv), additionalData: new TextEncoder().encode(aad) },
    key,
    fromBase64url(ciphertext),
  );
  return { plaintext: new TextDecoder().decode(plaintext), kid };
}
