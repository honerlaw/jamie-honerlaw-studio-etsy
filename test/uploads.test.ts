import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { addListingImage } from "../src/tools/listings/add-listing-image";
import { attachUploadedPhotos } from "../src/tools/listings/attach-uploaded-photos";
import { requestPhotoUpload } from "../src/tools/listings/request-photo-upload";
import { inspectImage } from "../src/uploads/inspect-image";
import { signUploadToken } from "../src/uploads/sign-upload-token";
import { uploadHmacKey } from "../src/uploads/upload-hmac-key";
import { uploadSessionKey } from "../src/uploads/upload-limits";
import { verifyUploadToken } from "../src/uploads/verify-upload-token";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { jpeg, png } from "./support/images";
import { call, ORIGIN } from "./support/oauth-flow";
import { LISTING_ROUTE, listing } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";
import { openSession, stage, upload } from "./support/upload-flow";
import { resultJson, resultText } from "./support/tool-result";

const IMAGES_ROUTE = "POST /v3/application/shops/2002/listings/555/images";
const KEY = env.UPLOAD_SIGNING_KEY;

let etsy: EtsyMock;
let nextImageId: number;

beforeEach(() => {
  etsy = mockEtsy();
  nextImageId = 100;
  etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
  etsy.routes.set(IMAGES_ROUTE, () => {
    nextImageId += 1;
    return Response.json({ listing_image_id: nextImageId, listing_id: 555 });
  });
});

const sentMarkers = () =>
  etsy
    .writes()
    .filter((request) => request.url.endsWith("/listings/555/images"))
    .map((request) => /IMG-\d/u.exec(request.body)?.[0]);

describe("upload tokens", () => {
  it("verifies a fresh token and rejects expired, tampered or malformed ones", async () => {
    const claims = { shopId: "2002", listingId: 555, nonce: "n", exp: 2000 };
    const token = await signUploadToken(KEY, claims);
    expect(await verifyUploadToken(KEY, token, 1000)).toStrictEqual(claims);
    expect(await verifyUploadToken(KEY, token, 2000)).toBeNull();
    const [payload = "", signature = ""] = token.split(".");
    const forged = btoa(JSON.stringify({ ...claims, listingId: 556 })).replaceAll("=", "");
    expect(await verifyUploadToken(KEY, `${forged}.${signature}`, 1000)).toBeNull();
    expect(await verifyUploadToken(KEY, `${payload}.${signature}x`, 1000)).toBeNull();
    expect(await verifyUploadToken(KEY, `${payload}.${signature}.x`, 1000)).toBeNull();
    expect(await verifyUploadToken(KEY, "!!.!!", 1000)).toBeNull();
    expect(await verifyUploadToken("another-key-another-key-another-key", token, 1000)).toBeNull();
  });

  it("refuses a short signing key", async () => {
    await expect(uploadHmacKey("short")).rejects.toThrow(TypeError);
  });
});

describe("POST /upload/image", () => {
  it("stages a valid photo in R2 under uploads/<nonce>/<rank>", async () => {
    const { token, nonce } = await openSession();
    expect((await upload(token, jpeg(800, 600), { "x-photo-rank": "3" })).status).toBe(201);
    expect((await upload(token, png(400, 400), { "x-photo-rank": "4", "content-type": "image/png" })).status).toBe(201);
    const keys = (await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects.map((object) => object.key);
    expect(keys).toStrictEqual([`uploads/${nonce}/03`, `uploads/${nonce}/04`]);
  });

  it.each([
    ["a cross-origin request", { origin: "https://evil.example" }, 403],
    ["no origin", { origin: "" }, 403],
    ["a missing token", { authorization: "" }, 401],
    ["an 11th photo (rank 10)", { "x-photo-rank": "10" }, 400],
    ["a negative rank", { "x-photo-rank": "-1" }, 400],
    ["an oversized photo", { "content-length": String(11 * 1024 * 1024) }, 413],
    ["a malformed content length", { "content-length": "12abc" }, 413],
  ])("rejects %s", async (_case, headers, status) => {
    const { token, nonce } = await openSession();
    expect((await upload(token, jpeg(10, 10), headers)).status).toBe(status);
    expect((await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects).toHaveLength(0);
  });

  it.each([
    ["bad magic bytes", new Uint8Array(new TextEncoder().encode("GIF89a not a photo")), 415],
    [
      "a JPEG with no frame header",
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78]),
      415,
    ],
    ["a photo wider than 6000 px", jpeg(6001, 100), 422],
    ["a PNG taller than 6000 px", png(100, 7000), 422],
  ])("rejects %s", async (_case, body, status) => {
    const { token } = await openSession();
    expect((await upload(token, body)).status).toBe(status);
  });

  it("rejects a body larger than it declared", async () => {
    const { token } = await openSession();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(jpeg(10, 10));
    expect((await upload(token, big, { "content-length": "100" })).status).toBe(413);
  });

  it("rejects an expired token, a tampered one, and one whose session was replaced or used", async () => {
    const { token } = await openSession();
    const expired = await signUploadToken(KEY, { shopId: "2002", listingId: 555, nonce: "n", exp: Date.now() - 1 });
    expect((await upload(expired, jpeg(10, 10))).status).toBe(401);
    expect((await upload(`${token}x`, jpeg(10, 10))).status).toBe(401);
    await openSession();
    expect((await upload(token, jpeg(10, 10))).status).toBe(410);
    const current = await openSession();
    await upload(current.token, jpeg(10, 10));
    await attachUploadedPhotos(toolDeps(), { listing_id: 555 });
    expect((await upload(current.token, jpeg(10, 10))).status).toBe(410);
  });

  it("refuses uploads while the photos are being attached", async () => {
    const { token } = await openSession();
    await toolDeps().store.claim(uploadSessionKey(555), 60_000);
    expect((await upload(token, jpeg(10, 10))).status).toBe(409);
  });
});

describe("GET /upload", () => {
  it("serves the page with the stated CSP, no referrer and no framing", async () => {
    const response = await call("/upload");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(
      /^default-src 'none'; script-src 'sha256-[\w+/=]+'; style-src 'sha256-[\w+/=]+'; img-src blob:; connect-src 'self';/u,
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const page = await response.text();
    expect(page).toContain('accept="image/*" multiple');
    expect(page).not.toMatch(/<script src|https?:\/\/(?!www\.w3)/u);
  });
});

describe("attach_uploaded_photos", () => {
  it("uploads in rank order as multipart, then deletes the staged photos and uses up the session", async () => {
    const { nonce } = await stage(3);
    const result = resultJson<{ attached: number; listing_image_ids: number[] }>(
      await attachUploadedPhotos(toolDeps(), { listing_id: 555 }),
    );
    expect(result).toStrictEqual({ attached: 3, listing_image_ids: [101, 102, 103] });
    expect(sentMarkers()).toStrictEqual(["IMG-0", "IMG-1", "IMG-2"]);
    expect(etsy.writes()[0]?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/u);
    expect((await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects).toHaveLength(0);
    expect(await toolDeps().store.peek(uploadSessionKey(555))).toBeNull();
  });

  it("lets only one of two concurrent attaches run", async () => {
    await stage(3);
    const results = await Promise.all([
      attachUploadedPhotos(toolDeps(), { listing_id: 555 }),
      attachUploadedPhotos(toolDeps(), { listing_id: 555 }),
    ]);
    expect(results.filter((result) => result.isError === true)).toHaveLength(1);
    expect(sentMarkers()).toStrictEqual(["IMG-0", "IMG-1", "IMG-2"]);
  });

  it("after failing on photo 3 of 5, a retry sends only photos 3 to 5", async () => {
    await stage(5);
    let calls = 0;
    etsy.routes.set(IMAGES_ROUTE, () => {
      calls += 1;
      if (calls === 3) {
        return new Response(null, { status: 503 });
      }
      nextImageId += 1;
      return Response.json({ listing_image_id: nextImageId });
    });
    const failed = await attachUploadedPhotos(toolDeps(), { listing_id: 555 });
    expect(failed.isError).toBe(true);
    expect(resultText(failed)).toContain("2 of 5 photos are on the listing");
    const retried = resultJson<{ attached: number }>(await attachUploadedPhotos(toolDeps(), { listing_id: 555 }));
    expect(retried.attached).toBe(5);
    expect(sentMarkers()).toStrictEqual(["IMG-0", "IMG-1", "IMG-2", "IMG-2", "IMG-3", "IMG-4"]);
    expect(new Set(sentMarkers().filter((_marker, index) => index !== 2)).size).toBe(5);
  });

  it("says so when nothing was uploaded, or no session is open", async () => {
    await openSession();
    expect(resultText(await attachUploadedPhotos(toolDeps(), { listing_id: 555 }))).toContain(
      "No photos have been uploaded",
    );
    expect(await toolDeps().store.peek(uploadSessionKey(555))).toMatchObject({ leased: false });
    expect(resultText(await attachUploadedPhotos(toolDeps(), { listing_id: 556 }))).toContain("No open upload");
  });

  it("treats an odd Etsy answer as a failure and keeps the photo for a retry", async () => {
    const { nonce } = await stage(1);
    etsy.routes.set(IMAGES_ROUTE, () => Response.json({ ok: true }));
    expect((await attachUploadedPhotos(toolDeps(), { listing_id: 555 })).isError).toBe(true);
    expect((await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects).toHaveLength(1);
  });
});

describe("request_photo_upload and add_listing_image", () => {
  it("hands out a link with the token in the fragment, for her listing only", async () => {
    const link = resultJson<{ upload_link: string }>(await requestPhotoUpload(toolDeps(), { listing_id: 555 }));
    expect(link.upload_link).toMatch(new RegExp(`^${ORIGIN}/upload#t=[\\w-]+\\.[\\w-]+$`, "u"));
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ shop_id: 1 })));
    expect((await requestPhotoUpload(toolDeps(), { listing_id: 555 })).isError).toBe(true);
  });

  it("fetches a download_url object and uploads it straight away", async () => {
    const photo = jpeg(200, 200, "IMG-9");
    const deps = toolDeps({
      fetchFile: () => Promise.resolve(new Response(photo, { headers: { "content-length": String(photo.length) } })),
    });
    const added = await addListingImage(deps, {
      listing_id: 555,
      image: { download_url: "https://files.example/p.jpg" },
    });
    expect(resultJson(added)).toStrictEqual({ added: 101 });
    expect(sentMarkers()).toStrictEqual(["IMG-9"]);
  });

  it("returns an upload link when the app sent a placeholder string", async () => {
    const added = resultJson<{ upload_link: string }>(
      await addListingImage(toolDeps(), { listing_id: 555, image: "file_placeholder" }),
    );
    expect(added.upload_link).toContain("/upload#t=");
    expect(etsy.writes()).toHaveLength(0);
  });

  it.each([
    ["http links", "http://files.example/p.jpg", () => new Response(jpeg(10, 10)), "must be https"],
    [
      "failed downloads",
      "https://files.example/p.jpg",
      () => new Response(null, { status: 404 }),
      "couldn't be downloaded",
    ],
    [
      "declared oversize",
      "https://files.example/p.jpg",
      () => new Response("x", { headers: { "content-length": "99999999" } }),
      "larger than 10 MB",
    ],
    [
      "actual oversize",
      "https://files.example/p.jpg",
      () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)),
      "larger than 10 MB",
    ],
    ["non-images", "https://files.example/p.jpg", () => new Response("hello"), "isn't a JPEG or PNG"],
  ])("refuses %s", async (_case, url, respond, message) => {
    const deps = toolDeps({ fetchFile: () => Promise.resolve(respond()) });
    expect(resultText(await addListingImage(deps, { listing_id: 555, image: { download_url: url } }))).toContain(
      message,
    );
    expect(etsy.writes()).toHaveLength(0);
  });

  it("reports Etsy refusing the photo", async () => {
    etsy.routes.set(IMAGES_ROUTE, () => new Response(null, { status: 400 }));
    const deps = toolDeps({ fetchFile: () => Promise.resolve(new Response(png(10, 10))) });
    expect(
      (await addListingImage(deps, { listing_id: 555, image: { download_url: "https://f.example/p.png" } })).isError,
    ).toBe(true);
    etsy.routes.set(LISTING_ROUTE, () => new Response(null, { status: 404 }));
    expect((await addListingImage(deps, { listing_id: 555, image: "x" })).isError).toBe(true);
  });
});

it("inspectImage reads JPEG segments before the frame header, and rejects truncated PNGs", () => {
  const withExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, ...jpeg(30, 20).slice(2)]);
  expect(inspectImage(withExif)).toStrictEqual({ type: "jpeg", width: 30, height: 20 });
  expect(inspectImage(png(5, 5).slice(0, 20))).toBeNull();
  expect(
    inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])),
  ).toBeNull();
});
