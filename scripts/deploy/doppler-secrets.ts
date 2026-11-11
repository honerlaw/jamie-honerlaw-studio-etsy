const DOWNLOAD_URL = "https://api.doppler.com/v3/configs/config/secrets/download?format=json";

/**
 * Every secret in the service token's config (`etsy-shop-mcp/prd`), minus
 * Doppler's own DOPPLER_* metadata. A service token is scoped to one config, so
 * the request names no project or config.
 */
export async function fetchDopplerSecrets(fetchFn: typeof fetch, token: string): Promise<Record<string, string>> {
  const response = await fetchFn(DOWNLOAD_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Doppler refused the secrets download (HTTP ${String(response.status)}). Check DOPPLER_TOKEN.`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Doppler returned something other than a JSON object of secrets.");
  }
  const secrets: Record<string, string> = {};
  for (const [name, value] of Object.entries(body)) {
    if (name.startsWith("DOPPLER_")) {
      continue;
    }
    if (typeof value !== "string") {
      throw new TypeError(`Doppler secret ${name} is not a string.`);
    }
    secrets[name] = value;
  }
  return secrets;
}
