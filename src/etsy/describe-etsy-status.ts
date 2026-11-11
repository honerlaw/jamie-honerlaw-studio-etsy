// A readable reason for a failed Etsy call, from the HTTP status alone. Etsy's response
// body is never surfaced, because some (orders, receipts) carry buyer details.
export function describeEtsyStatus(status: number): string {
  if (status === 401) {
    return "Etsy rejected the connection. Reconnect in the connector settings.";
  }
  if (status === 403) {
    return "Etsy says this connection isn't allowed to do that.";
  }
  if (status === 404) {
    return "Etsy couldn't find that.";
  }
  if (status === 429) {
    return "Etsy is rate-limiting requests. Try again in a minute.";
  }
  if (status >= 500) {
    return "Etsy is having trouble right now. Try again in a minute.";
  }
  return `Etsy refused the request (HTTP ${String(status)}).`;
}
