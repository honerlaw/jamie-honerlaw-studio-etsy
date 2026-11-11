import { z } from "zod";

export interface KeyRing {
  readonly currentKid: string;
  readonly keys: ReadonlyMap<string, CryptoKey>;
}

const KID = /^[A-Za-z0-9_-]{1,32}$/u;
const KEYS_SCHEMA = z.record(z.string().regex(KID), z.base64());

// Parses TOKEN_ENC_KEYS (a JSON map of key id to a base64 256-bit key) and checks that
// TOKEN_ENC_KID names one of them. Throws on any malformed input, so a bad secret fails
// loudly at the first vault call instead of silently storing tokens unencrypted. The
// messages are fixed strings: a parser error would quote the secret itself.
export async function parseKeyRing(keysJson: string, currentKid: string): Promise<KeyRing> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(keysJson);
  } catch {
    throw new TypeError('TOKEN_ENC_KEYS must be a JSON map like {"k1":"<base64 key>"}');
  }
  const parsed = KEYS_SCHEMA.safeParse(decoded);
  if (!parsed.success) {
    throw new TypeError("TOKEN_ENC_KEYS must map short key ids to base64 keys");
  }
  const raw = parsed.data;
  const keys = new Map<string, CryptoKey>();
  for (const [kid, encoded] of Object.entries(raw)) {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (bytes.length !== 32) {
      throw new TypeError("every TOKEN_ENC_KEYS key must be 32 bytes (AES-256)");
    }
    keys.set(kid, await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  if (!keys.has(currentKid)) {
    throw new TypeError("TOKEN_ENC_KID must name a key in TOKEN_ENC_KEYS");
  }
  return { currentKid, keys };
}
