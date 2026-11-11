type FieldValue = string | number | boolean;

// Only these fields are ever written. Anything else is dropped, so a caller can't leak a
// token, a buyer's details or a response body by passing it in. Request and response
// bodies are never logged.
const LOGGABLE_FIELDS = new Set(["status", "reason", "outcome", "tool", "route"]);

// The only place the Worker writes to the console (Workers Logs picks it up).
export function logEvent(event: string, fields: Readonly<Record<string, FieldValue>> = {}): void {
  const safe: Record<string, FieldValue> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (LOGGABLE_FIELDS.has(key)) {
      safe[key] = value;
    }
  }
  console.log(JSON.stringify(safe));
}
