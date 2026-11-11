const MAX_RETRIES = 2;
const MAX_WAIT_SECONDS = 10;

// How many more Etsy requests one Worker invocation may send. Workers Free allows 50
// outbound subrequests per invocation and every 429 retry is one, so each invocation
// shares one budget and stops before the platform would throw.
export interface SubrequestBudget {
  // Uses one request up; false when none are left.
  take(): boolean;
}

// What the budget answers once it's spent: a 429, which multi-page reads treat as the
// end of the data (truncated) rather than a failure.
function spent(): Response {
  return new Response(null, { status: 429, statusText: "Subrequest budget spent" });
}

// Wraps fetch so a 429 is retried up to twice, waiting for Etsy's Retry-After (capped,
// so one tool call can't hang). Each attempt sends a fresh clone of the request and
// draws on `budget`, when one is given.
export function fetchWithRetry(
  fetcher: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  budget?: SubrequestBudget,
): (request: Request) => Promise<Response> {
  return async (request) => {
    for (let attempt = 0; ; attempt += 1) {
      if (budget !== undefined && !budget.take()) {
        return spent();
      }
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
