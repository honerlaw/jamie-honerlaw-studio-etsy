// Every client_id a request to /authorize or /token claims, read exactly the way the
// pinned OAuth library reads it, so the gate and the library can't disagree about which
// client is asking. A malformed Basic header yields "", which is never on the list.
// Reads a clone, so the provider still sees the original body.
export async function requestedClientIds(request: Request): Promise<readonly string[]> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize") {
    return url.searchParams.getAll("client_id");
  }
  const ids: string[] = [];
  const header = request.headers.get("authorization") ?? "";
  const schemeEnd = header.search(/[ \t]/u);
  if ((schemeEnd === -1 ? header : header.slice(0, schemeEnd)).toLowerCase() === "basic") {
    ids.push(basicClientId(schemeEnd === -1 ? "" : header.slice(schemeEnd).trim()));
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(await request.clone().text());
    ids.push(...form.getAll("client_id").filter((id) => id !== ""));
  }
  return ids;
}

// The client id from Basic credentials (RFC 6749 form encoding), or "" when malformed.
function basicClientId(encoded: string): string {
  if (encoded === "" || /[ \t]/u.test(encoded)) {
    return "";
  }
  try {
    const credentials = atob(encoded);
    const separator = credentials.indexOf(":");
    return separator === -1 ? "" : decodeURIComponent(credentials.slice(0, separator).replaceAll("+", " "));
  } catch {
    return "";
  }
}
