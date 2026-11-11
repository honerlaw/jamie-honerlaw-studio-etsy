import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { addListingImage } from "../src/tools/listings/add-listing-image";
import { attachUploadedPhotos } from "../src/tools/listings/attach-uploaded-photos";
import { handleUploadImage } from "../src/uploads/handle-upload-image";
import { startUploadSession } from "../src/uploads/start-upload-session";
import { uploadSessionKey } from "../src/uploads/upload-limits";
import { mockEtsy, type EtsyMock } from "./support/etsy-mock";
import { jpeg } from "./support/images";
import { ORIGIN } from "./support/oauth-flow";
import { LISTING_ROUTE, listing } from "./support/shop-fixtures";
import { toolDeps } from "./support/tool-deps";
import { resultJson, resultText } from "./support/tool-result";
import { openSession, stage, upload } from "./support/upload-flow";

const IMAGES_ROUTE = "POST /v3/application/shops/2002/listings/555/images";
const KEY = uploadSessionKey(555);

let etsy: EtsyMock;
let nextImageId: number;

beforeEach(() => {
  etsy = mockEtsy();
  nextImageId = 100;
  etsy.routes.set(LISTING_ROUTE, () => Response.json(listing()));
  etsy.routes.set(IMAGES_ROUTE, () => {
    nextImageId += 1;
    return Response.json({ listing_image_id: nextImageId });
  });
});

const imageWrites = () => etsy.writes().filter((request) => request.url.endsWith("/listings/555/images"));
const sentMarkers = () => imageWrites().map((request) => /IMG-\d/u.exec(request.body)?.[0]);
const sentRanks = () => imageWrites().map((request) => /name="rank"\r\n\r\n(\d+)/u.exec(request.body)?.[1]);

const image = (id: number) => ({
  listing_image_id: id,
  rank: id,
  url_570xN: `https://i.etsystatic.com/${String(id)}.jpg`,
});

// Records `rank`'s staged photo as already on Etsy, as a run that died after Etsy took
// it (but before the staged copy was deleted) would have left it.
async function markUploaded(nonce: string, rank: number): Promise<void> {
  const store = toolDeps().store;
  const held = await store.claim(KEY, 60_000);
  const object = `uploads/${nonce}/${String(rank).padStart(2, "0")}`;
  await store.update(KEY, held?.lease ?? "", JSON.stringify({ nonce, uploaded: { [object]: 7 } }));
  await store.release(KEY, held?.lease ?? "");
}

describe("photo positions on Etsy", () => {
  it("places attached photos after the listing's existing ones, in her order", async () => {
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ images: [image(1), image(2)] })));
    await stage(3);
    await attachUploadedPhotos(toolDeps(), { listing_id: 555 });
    expect(sentMarkers()).toStrictEqual(["IMG-0", "IMG-1", "IMG-2"]);
    expect(sentRanks()).toStrictEqual(["3", "4", "5"]);
  });

  it("puts a fast-path photo last, and first on a listing with none", async () => {
    const photo = jpeg(50, 50);
    const deps = toolDeps({ fetchFile: () => Promise.resolve(new Response(photo)) });
    await addListingImage(deps, { listing_id: 555, image: { download_url: "https://f.example/a.jpg" } });
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ images: null })));
    await addListingImage(deps, { listing_id: 555, image: { download_url: "https://f.example/b.jpg" } });
    expect(sentRanks()).toStrictEqual(["2", "1"]);
  });

  it("stops reading a download past 10 MB even without a declared size", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const deps = toolDeps({ fetchFile: () => Promise.resolve(new Response(stream)) });
    const result = await addListingImage(deps, { listing_id: 555, image: { download_url: "https://f.example/c.jpg" } });
    expect(resultText(result)).toContain("larger than 10 MB");
    expect(sent).toBeLessThan(15);
    expect(etsy.writes()).toHaveLength(0);
  });

  it("refuses a download that isn't bytes", async () => {
    const stream = new ReadableStream({
      start: (controller) => {
        controller.enqueue("text");
        controller.close();
      },
    });
    const deps = toolDeps({ fetchFile: () => Promise.resolve(new Response(stream)) });
    const result = await addListingImage(deps, { listing_id: 555, image: { download_url: "https://f.example/d.jpg" } });
    expect(resultText(result)).toContain("couldn't be downloaded");
  });
});

describe("no photo lands on Etsy twice", () => {
  it("keeps appending in order on a retry after a partial run", async () => {
    let onEtsy = [image(1), image(2)];
    etsy.routes.set(LISTING_ROUTE, () => Response.json(listing({ images: onEtsy })));
    await stage(3);
    let calls = 0;
    etsy.routes.set(IMAGES_ROUTE, () => {
      calls += 1;
      if (calls === 2) {
        return new Response(null, { status: 503 });
      }
      nextImageId += 1;
      onEtsy = [...onEtsy, image(nextImageId)];
      return Response.json({ listing_image_id: nextImageId });
    });
    expect((await attachUploadedPhotos(toolDeps(), { listing_id: 555 })).isError).toBe(true);
    await attachUploadedPhotos(toolDeps(), { listing_id: 555 });
    expect(sentMarkers()).toStrictEqual(["IMG-0", "IMG-1", "IMG-1", "IMG-2"]);
    expect(sentRanks()).toStrictEqual(["3", "4", "4", "5"]);
  });

  it("skips a staged photo already recorded as uploaded, and deletes its staged copy", async () => {
    const { nonce } = await stage(2);
    await markUploaded(nonce, 0);
    const result = resultJson<{ attached: number }>(await attachUploadedPhotos(toolDeps(), { listing_id: 555 }));
    expect(result.attached).toBe(2);
    expect(sentMarkers()).toStrictEqual(["IMG-1"]);
    expect((await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects).toHaveLength(0);
  });

  it("refuses re-uploading a position that's already on the listing", async () => {
    const { token, nonce } = await stage(1);
    await markUploaded(nonce, 0);
    expect((await upload(token, jpeg(100, 100))).status).toBe(409);
    expect((await upload(token, jpeg(100, 100), { "x-photo-rank": "1" })).status).toBe(201);
  });
});

describe("a session replaced or claimed mid-way", () => {
  it("stops an attach whose link was replaced, leaving the new session intact", async () => {
    await stage(3);
    let replaced = false;
    // While Etsy takes the first photo, a new link for the same listing is handed out.
    etsy.routes.set(IMAGES_ROUTE, async () => {
      if (!replaced) {
        replaced = true;
        await startUploadSession(toolDeps(), { shopId: "2002", listingId: 555 }, Date.now());
      }
      nextImageId += 1;
      return Response.json({ listing_image_id: nextImageId });
    });
    const attached = await attachUploadedPhotos(toolDeps(), { listing_id: 555 });
    expect(resultText(attached)).toContain("A new upload link replaced this one");
    expect(sentMarkers()).toStrictEqual(["IMG-0"]);
    const fresh = await toolDeps().store.peek(KEY);
    expect(fresh?.leased).toBe(false);
    expect(JSON.parse(fresh?.value ?? "{}")).toMatchObject({ uploaded: {} });
  });

  it("takes back a photo that arrived after an attach claimed the session", async () => {
    const { token, nonce } = await openSession();
    const store = toolDeps().store;
    const uploads = {
      put: async (key: string, value: Uint8Array, options: R2PutOptions) => {
        await env.UPLOADS.put(key, value, options);
        await store.claim(KEY, 60_000);
      },
      delete: (key: string) => env.UPLOADS.delete(key),
    } as unknown as R2Bucket;
    const photo = jpeg(100, 100);
    const request = new Request(`${ORIGIN}/upload/image`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        authorization: `Upload ${token}`,
        "x-photo-rank": "0",
        "content-length": String(photo.length),
      },
      body: photo,
    });
    const response = await handleUploadImage(request, { ...env, UPLOADS: uploads });
    expect(response.status).toBe(409);
    expect((await env.UPLOADS.list({ prefix: `uploads/${nonce}/` })).objects).toHaveLength(0);
  });
});
