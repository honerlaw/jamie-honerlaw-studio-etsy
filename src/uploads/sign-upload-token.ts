import { base64url } from "../vault/base64url";
import type { UploadClaims } from "./upload-claims";
import { uploadHmacKey } from "./upload-hmac-key";

// `<claims>.<signature>`, both base64url: an HMAC-SHA256 over the encoded claims.
export async function signUploadToken(secret: string, claims: UploadClaims): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await uploadHmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}
