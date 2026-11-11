import { fromBase64url } from "../vault/from-base64url";
import { UPLOAD_CLAIMS, type UploadClaims } from "./upload-claims";
import { uploadHmacKey } from "./upload-hmac-key";

// The token's claims if its signature checks out (constant-time, by crypto.subtle) and
// it hasn't expired; otherwise null.
export async function verifyUploadToken(secret: string, token: string, now: number): Promise<UploadClaims | null> {
  const [payload, signature, extra] = token.split(".");
  if (payload === undefined || signature === undefined || extra !== undefined) {
    return null;
  }
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await uploadHmacKey(secret),
      fromBase64url(signature),
      new TextEncoder().encode(payload),
    );
    if (!valid) {
      return null;
    }
    const claims = UPLOAD_CLAIMS.safeParse(JSON.parse(new TextDecoder().decode(fromBase64url(payload))));
    return claims.success && claims.data.exp > now ? claims.data : null;
  } catch {
    return null;
  }
}
