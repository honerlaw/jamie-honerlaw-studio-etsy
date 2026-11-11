import { UPLOAD_SCRIPT, UPLOAD_STYLE } from "./upload-page-assets";

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

// GET /upload: the photo picker. The token is in the URL fragment, which the browser
// never sends here, so this page is the same for everyone and holds no secret. The CSP
// allows only its own script and style (by hash), blob: thumbnails, and requests back
// to this origin; the page can't be framed and sends no referrer.
export async function handleUploadPage(): Promise<Response> {
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${await sha256Base64(UPLOAD_SCRIPT)}'`,
    `style-src 'sha256-${await sha256Base64(UPLOAD_STYLE)}'`,
    "img-src blob:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Add photos</title>` +
    `<style>${UPLOAD_STYLE}</style></head><body><main><h1>Add photos to your listing</h1>` +
    `<p>Pick up to 10 photos, put them in the order you want, then tap Upload.</p>` +
    `<label class="pick">Choose or take photos<input id="pick" type="file" accept="image/*" multiple></label>` +
    `<ol id="list"></ol><button id="send" type="button" disabled>Upload</button>` +
    `<p id="status" role="status"></p></main><script>${UPLOAD_SCRIPT}</script></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
