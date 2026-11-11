import createClient, { type Client } from "openapi-fetch";

import { fetchWithRetry } from "./fetch-with-retry";
import type { paths } from "./generated/schema";

export type EtsyClient = Client<paths>;

export interface EtsyClientOptions {
  readonly apiKey: string;
  readonly accessToken: string;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
}

// A client typed from the committed spec snapshot. Every request carries the
// `keystring:shared_secret` API key and her bearer token, and 429s are retried.
export function createEtsyClient(options: EtsyClientOptions): EtsyClient {
  return createClient<paths>({
    baseUrl: "https://api.etsy.com",
    fetch: fetchWithRetry(options.fetch, options.sleep),
    headers: { "x-api-key": options.apiKey, authorization: `Bearer ${options.accessToken}` },
  });
}
