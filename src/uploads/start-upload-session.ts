import { base64url } from "../vault/base64url";
import type { OneTimeStoreApi } from "../tools/shop-tool-deps";
import { signUploadToken } from "./sign-upload-token";
import { UPLOAD_LIMITS, uploadSessionKey } from "./upload-limits";
import type { UploadSession } from "./upload-session";

// Opens a fresh upload session for a listing (replacing any earlier one, whose link then
// stops working) and returns the link to the upload page. The token rides in the URL
// fragment, which browsers never send to a server or put in a Referer header.
export async function startUploadSession(
  context: { readonly store: OneTimeStoreApi; readonly uploadSigningKey: string; readonly origin: string },
  target: { readonly shopId: string; readonly listingId: number },
  now: number,
): Promise<{ readonly url: string; readonly expiresAt: string }> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const exp = now + UPLOAD_LIMITS.sessionTtlMs;
  const token = await signUploadToken(context.uploadSigningKey, { ...target, nonce, exp });
  const session: UploadSession = { nonce, uploaded: {} };
  await context.store.put(uploadSessionKey(target.listingId), JSON.stringify(session), UPLOAD_LIMITS.sessionTtlMs);
  return { url: `${context.origin}/upload#t=${token}`, expiresAt: new Date(exp).toISOString() };
}
