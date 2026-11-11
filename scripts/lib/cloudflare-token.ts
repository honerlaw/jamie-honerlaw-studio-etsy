import { createHash } from "node:crypto";

const API = "https://api.cloudflare.com/client/v4";

const TOKEN_PERMISSIONS =
  "Account: Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit, Account Settings Read; User: Memberships Read";

interface VerifyBody {
  readonly success?: unknown;
  readonly result?: { readonly id?: unknown; readonly status?: unknown } | null;
}

async function verify(fetchFn: typeof fetch, url: string, token: string): Promise<string | undefined> {
  const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as VerifyBody;
  const id = body.result?.id;
  return body.success === true && body.result?.status === "active" && typeof id === "string" ? id : undefined;
}

/**
 * The API token's id. A user-owned token verifies at /user/tokens/verify, an
 * account-owned one at /accounts/{id}/tokens/verify; both kinds work for R2.
 */
export async function cloudflareTokenId(fetchFn: typeof fetch, token: string, accountId: string): Promise<string> {
  const id =
    (await verify(fetchFn, `${API}/user/tokens/verify`, token)) ??
    (await verify(fetchFn, `${API}/accounts/${encodeURIComponent(accountId)}/tokens/verify`, token));
  if (id === undefined) {
    throw new Error(`CLOUDFLARE_API_TOKEN did not verify as an active token. It needs: ${TOKEN_PERMISSIONS}.`);
  }
  return id;
}

export interface R2Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** R2's S3 credentials for an API token: its id, and the SHA-256 of its value. */
export function r2Credentials(tokenId: string, token: string): R2Credentials {
  return { accessKeyId: tokenId, secretAccessKey: createHash("sha256").update(token).digest("hex") };
}
