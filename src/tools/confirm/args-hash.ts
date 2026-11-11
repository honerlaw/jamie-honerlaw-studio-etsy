import { canonicalJson } from "./canonical-json";

// SHA-256 (hex) of the canonical JSON of a gated tool's parsed arguments, without the
// confirmation token itself. Parsed means zod has applied defaults, so omitting a default
// and spelling it out hash the same, as do the same arguments in another key order.
export async function argsHash(args: object): Promise<string> {
  const rest = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "confirmation_token"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(rest)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
