import { exports } from "cloudflare:workers";

export const ORIGIN = "https://mcp.example.com";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// Matches the "claude" entry of MCP_CLIENTS in vitest.config.ts.
export const CLAUDE_ID = "claude";
export const CLAUDE_SECRET = "test-only-".repeat(4);

export function basicAuth(id: string, secret: string): string {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

// Minimal cookie jar: remembers name=value from Set-Cookie, drops Max-Age=0 cookies.
class CookieJar {
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

// Opens /authorize as the pre-registered Claude client and stops at the redirect to Etsy.
export async function startAuthorization(): Promise<EtsyRedirect> {
  const { verifier, challenge } = await pkcePair();
  const jar = new CookieJar();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLAUDE_ID,
    redirect_uri: CLAUDE_REDIRECT,
    state: "client-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ORIGIN}/mcp`,
  });
  const started = await call(`/authorize?${query.toString()}`);
  jar.absorb(started);
  return {
    jar,
    clientId: CLAUDE_ID,
    verifier,
    etsyUrl: new URL(started.headers.get("location") ?? "https://invalid.example"),
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

// Authorize, Etsy sign-in, and stop with the authorization code the client receives.
export async function authorizationCode(): Promise<EtsyRedirect & { code: string }> {
  const redirect = await startAuthorization();
  const callback = await etsyCallback(redirect);
  const code = new URL(callback.headers.get("location") ?? "https://invalid.example").searchParams.get("code") ?? "";
  return { ...redirect, code };
}

// POSTs a form to /token, authenticating as `credentials` with HTTP Basic when given.
export function tokenRequest(form: Record<string, string>, credentials?: readonly [string, string]): Promise<Response> {
  return call("/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(credentials === undefined ? {} : { authorization: basicAuth(...credentials) }),
    },
    body: new URLSearchParams(form),
  });
}

// The whole happy path: authorize, Etsy sign-in, code-for-token exchange.
export async function connect(): Promise<Connected> {
  const redirect = await authorizationCode();
  const token = await tokenRequest(
    {
      grant_type: "authorization_code",
      code: redirect.code,
      redirect_uri: CLAUDE_REDIRECT,
      code_verifier: redirect.verifier,
      resource: `${ORIGIN}/mcp`,
    },
    [CLAUDE_ID, CLAUDE_SECRET],
  );
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
