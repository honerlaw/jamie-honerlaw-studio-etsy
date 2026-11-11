import { exports } from "cloudflare:workers";

export const ORIGIN = "https://mcp.example.com";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

// Minimal cookie jar: remembers name=value from Set-Cookie, drops Max-Age=0 cookies.
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (/max-age=0/iu.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, pair.slice(separator + 1));
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export function call(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }));
}

export async function registerClient(redirectUris: readonly string[] = [CLAUDE_REDIRECT]): Promise<Response> {
  return call("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export interface EtsyRedirect {
  readonly jar: CookieJar;
  readonly clientId: string;
  readonly verifier: string;
  // Etsy's consent URL the Worker redirected to, with our state and PKCE challenge.
  readonly etsyUrl: URL;
}

// Registers a client, opens /authorize, approves, and stops at the redirect to Etsy.
export async function startAuthorization(): Promise<EtsyRedirect> {
  const registered = await (await registerClient()).json<{ client_id: string }>();
  const { verifier, challenge } = await pkcePair();
  const jar = new CookieJar();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: CLAUDE_REDIRECT,
    state: "client-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });
  const page = await call(`/authorize?${query.toString()}`);
  jar.absorb(page);
  const handle = /name="handle" value="([^"]+)"/u.exec(await page.text())?.[1] ?? "";
  const approved = await call("/authorize", {
    method: "POST",
    headers: { cookie: jar.header(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ handle, decision: "approve" }),
  });
  jar.absorb(approved);
  return {
    jar,
    clientId: registered.client_id,
    verifier,
    etsyUrl: new URL(approved.headers.get("location") ?? "https://invalid.example"),
  };
}

// Simulates Etsy redirecting back to /callback with a code for the given state.
export function etsyCallback(redirect: EtsyRedirect, state?: string): Promise<Response> {
  const query = new URLSearchParams({
    code: "etsy-code",
    state: state ?? redirect.etsyUrl.searchParams.get("state") ?? "",
  });
  return call(`/callback?${query.toString()}`, { headers: { cookie: redirect.jar.header() } });
}

export interface Connected {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly clientId: string;
}

// The whole happy path: authorize, Etsy sign-in, code-for-token exchange.
export async function connect(): Promise<Connected> {
  const redirect = await startAuthorization();
  const callback = await etsyCallback(redirect);
  const code = new URL(callback.headers.get("location") ?? "https://invalid.example").searchParams.get("code") ?? "";
  const token = await call("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: redirect.clientId,
      code_verifier: redirect.verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  const body = await token.json<{ access_token: string; refresh_token: string }>();
  return { accessToken: body.access_token, refreshToken: body.refresh_token, clientId: redirect.clientId };
}

// One JSON-RPC call to /mcp.
export function mcp(accessToken: string, method: string, params: Record<string, unknown> = {}): Promise<Response> {
  return call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
