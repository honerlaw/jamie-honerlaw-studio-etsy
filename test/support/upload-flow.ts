import { env } from "cloudflare:workers";

import { startUploadSession } from "../../src/uploads/start-upload-session";
import { verifyUploadToken } from "../../src/uploads/verify-upload-token";
import { jpeg } from "./images";
import { call, ORIGIN } from "./oauth-flow";
import { toolDeps } from "./tool-deps";

// Opens an upload session for listing 555 and returns its token and nonce.
export async function openSession(): Promise<{ token: string; nonce: string }> {
  const link = await startUploadSession(toolDeps(), { shopId: "2002", listingId: 555 }, Date.now());
  const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get("t") ?? "";
  const claims = await verifyUploadToken(env.UPLOAD_SIGNING_KEY, token, Date.now());
  return { token, nonce: claims?.nonce ?? "" };
}

// POSTs one photo the way the upload page does.
export function upload(
  token: string,
  body: Uint8Array<ArrayBuffer>,
  extra: Record<string, string> = {},
): Promise<Response> {
  return call("/upload/image", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: `Upload ${token}`,
      "x-photo-rank": "0",
      "content-type": "image/jpeg",
      "content-length": String(body.length),
      ...extra,
    },
    body,
  });
}

// Opens a session and stages `count` photos marked IMG-0, IMG-1, … in ranks 0, 1, …
export async function stage(count: number): Promise<{ token: string; nonce: string }> {
  const session = await openSession();
  for (let rank = 0; rank < count; rank += 1) {
    await upload(session.token, jpeg(100, 100, `IMG-${String(rank)}`), { "x-photo-rank": String(rank) });
  }
  return session;
}
