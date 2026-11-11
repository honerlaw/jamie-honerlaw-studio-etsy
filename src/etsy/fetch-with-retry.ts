const MAX_RETRIES = 2;
const MAX_WAIT_SECONDS = 10;

// Wraps fetch so a 429 is retried up to twice, waiting for Etsy's Retry-After (capped,
// so one tool call can't hang). Each attempt sends a fresh clone of the request.
export function fetchWithRetry(
  fetcher: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetcher(request.clone());
      if (response.status !== 429 || attempt >= MAX_RETRIES) {
        return response;
      }
      const seconds = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_WAIT_SECONDS) : 1;
      await sleep(wait * 1000);
    }
  };
}
