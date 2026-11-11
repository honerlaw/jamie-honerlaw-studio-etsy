// A minimal page: no scripts, no styles, no third-party content, never cached and never
// framed. `bodyHtml` must already be escaped. `headers` adds to (or overrides) the defaults.
export function htmlPage(status: number, title: string, bodyHtml: string, headers?: Headers): Response {
  const response = new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title></head><body>${bodyHtml}</body></html>`,
    { status, headers: headers ?? new Headers() },
  );
  response.headers.set("content-type", "text/html; charset=utf-8");
  response.headers.set("cache-control", "no-store");
  response.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
