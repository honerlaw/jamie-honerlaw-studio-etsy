import { oneTimeStoreStub } from "../auth/one-time-store-stub";
import { inspectImage } from "./inspect-image";
import { UPLOAD_LIMITS, uploadSessionKey } from "./upload-limits";
import { UPLOAD_SESSION } from "./upload-session";
import { verifyUploadToken } from "./verify-upload-token";

function refuse(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// POST /upload/image: one photo from the upload page. It must come from this origin
// with the token in the Authorization header (a cross-site form can set neither), for a
// session that is still open and not being attached. The photo must be a JPEG or PNG of
// at most 10 MB and 6000 px a side. It is staged in R2 under uploads/<nonce>/<rank>;
// the rank (0–9, her order) is part of the key, so at most 10 can be staged and
// uploading the same position again replaces it. One photo per request: a request holds
// at most one 10 MB image in memory, well inside the Worker's 128 MB.
export async function handleUploadImage(
  request: Request,
  env: Pick<Env, "ONE_TIME_STORE" | "UPLOADS" | "UPLOAD_SIGNING_KEY">,
  now: number = Date.now(),
): Promise<Response> {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return refuse(403, "Uploads must come from the upload page.");
  }
  const token = /^Upload (\S+)$/u.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const claims = await verifyUploadToken(env.UPLOAD_SIGNING_KEY, token, now);
  if (claims === null) {
    return refuse(401, "This upload link has expired. Ask for a new one.");
  }
  const session = await oneTimeStoreStub(env).peek(uploadSessionKey(claims.listingId));
  const parsed = session === null ? null : UPLOAD_SESSION.safeParse(JSON.parse(session.value));
  if (parsed?.success !== true || parsed.data.nonce !== claims.nonce) {
    return refuse(410, "This upload link was replaced or already used. Ask for a new one.");
  }
  if (session?.leased === true) {
    return refuse(409, "The photos are being added to the listing right now.");
  }
  const rank = Number(request.headers.get("x-photo-rank"));
  if (!Number.isInteger(rank) || rank < 0 || rank >= UPLOAD_LIMITS.maxImages) {
    return refuse(400, "At most 10 photos per upload.");
  }
  const length = request.headers.get("content-length") ?? "";
  if (!/^\d+$/u.test(length) || Number(length) > UPLOAD_LIMITS.maxBytes) {
    return refuse(413, "Each photo must be 10 MB or less.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > UPLOAD_LIMITS.maxBytes) {
    return refuse(413, "Each photo must be 10 MB or less.");
  }
  const image = inspectImage(bytes);
  if (image === null) {
    return refuse(415, "That isn't a JPEG or PNG photo.");
  }
  if (image.width > UPLOAD_LIMITS.maxSidePx || image.height > UPLOAD_LIMITS.maxSidePx) {
    return refuse(422, "That photo is larger than 6000 pixels on a side.");
  }
  await env.UPLOADS.put(`uploads/${claims.nonce}/${String(rank).padStart(2, "0")}`, bytes, {
    httpMetadata: { contentType: `image/${image.type}` },
  });
  return new Response(null, { status: 201 });
}
