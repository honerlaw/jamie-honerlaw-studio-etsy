// The client_id a request to /authorize or /token claims: the query string for
// /authorize; HTTP Basic credentials or the form body for /token. Reads a clone, so the
// provider still sees the original body.
export async function requestedClientId(request: Request): Promise<string | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize") {
    return url.searchParams.get("client_id") ?? undefined;
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (/^basic\s/iu.test(authorization)) {
    try {
      const decoded = atob(authorization.slice(6).trim());
      const separator = decoded.indexOf(":");
      return separator > 0 ? decodeURIComponent(decoded.slice(0, separator)) : undefined;
    } catch {
      return undefined;
    }
  }
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return undefined;
  }
  const form = new URLSearchParams(await request.clone().text());
  return form.get("client_id") ?? undefined;
}
