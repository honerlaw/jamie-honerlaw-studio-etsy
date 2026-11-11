const API = "https://api.cloudflare.com/client/v4";

export const STATE_BUCKET = "etsy-shop-mcp-tfstate";

interface Account {
  readonly fetch: typeof fetch;
  readonly token: string;
  readonly accountId: string;
}

function call(account: Account, path: string, init: RequestInit = {}): Promise<Response> {
  return account.fetch(`${API}/accounts/${encodeURIComponent(account.accountId)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
  });
}

/** Stops with instructions unless the account is reachable, R2 is enabled and a workers.dev subdomain exists. */
export async function checkPrerequisites(account: Account): Promise<void> {
  // A user-owned token verifies whatever account id is given, so the id is checked on its own.
  if (!(await call(account, "")).ok) {
    throw new Error(
      `Cloudflare account ${account.accountId} was not found, or the token does not cover it. ` +
        "Check the account id (on the account's home page in the dashboard).",
    );
  }
  if (!(await call(account, "/r2/buckets")).ok) {
    throw new Error(
      "R2 is not enabled on this Cloudflare account (or the token lacks Workers R2 Storage Edit). " +
        "Enable R2 in the dashboard first; it asks for a payment method, but this use stays in the free tier.",
    );
  }
  const subdomain = await call(account, "/workers/subdomain");
  const body = subdomain.ok ? ((await subdomain.json()) as { readonly result?: { readonly subdomain?: unknown } }) : {};
  const name = body.result?.subdomain;
  if (typeof name !== "string" || name === "") {
    throw new Error(
      "This account has no workers.dev subdomain yet. Pick one in the dashboard (Workers & Pages), then re-run.",
    );
  }
}

/** Creates the Terraform state bucket unless it exists. Returns whether it was created. */
export async function ensureStateBucket(account: Account): Promise<boolean> {
  const found = await call(account, `/r2/buckets/${STATE_BUCKET}`);
  if (found.ok) {
    return false;
  }
  if (found.status !== 404) {
    throw new Error(`Could not check the ${STATE_BUCKET} bucket (HTTP ${String(found.status)}).`);
  }
  const created = await call(account, "/r2/buckets", { method: "POST", body: JSON.stringify({ name: STATE_BUCKET }) });
  if (!created.ok) {
    throw new Error(`Could not create the ${STATE_BUCKET} bucket (HTTP ${String(created.status)}).`);
  }
  return true;
}
