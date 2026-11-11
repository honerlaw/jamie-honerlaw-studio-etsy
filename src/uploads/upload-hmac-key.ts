// The HMAC-SHA256 key for upload tokens. A key shorter than 32 characters is refused,
// so a placeholder secret can't sign anything.
export async function uploadHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new TypeError("UPLOAD_SIGNING_KEY must be at least 32 characters");
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
