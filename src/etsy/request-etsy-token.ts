import { z } from "zod";

const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export interface EtsyTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export type TokenOutcome =
  | { readonly kind: "ok"; readonly tokens: EtsyTokens }
  | { readonly kind: "invalid_grant" }
  | { readonly kind: "unavailable"; readonly status: number };

const TOKEN_RESPONSE = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const ERROR_RESPONSE = z.object({ error: z.string() });

// POSTs one OAuth form to Etsy's token endpoint (code exchange or refresh). Never throws
// and never surfaces the response body: Etsy's `invalid_grant` (dead or revoked grant)
// becomes its own outcome, and everything else is "unavailable" with the HTTP status.
export async function requestEtsyToken(
  fetcher: typeof fetch,
  apiKey: string,
  form: Readonly<Record<string, string>>,
): Promise<TokenOutcome> {
  let response: Response;
  try {
    response = await fetcher(ETSY_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-api-key": apiKey },
      body: new URLSearchParams(form),
    });
  } catch {
    return { kind: "unavailable", status: 0 };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = TOKEN_RESPONSE.safeParse(body);
    if (!parsed.success) {
      return { kind: "unavailable", status: response.status };
    }
    const { access_token, refresh_token, expires_in } = parsed.data;
    return {
      kind: "ok",
      tokens: { accessToken: access_token, refreshToken: refresh_token, expiresInSeconds: expires_in },
    };
  }
  const error = ERROR_RESPONSE.safeParse(body);
  if (error.success && error.data.error === "invalid_grant") {
    return { kind: "invalid_grant" };
  }
  return { kind: "unavailable", status: response.status };
}
