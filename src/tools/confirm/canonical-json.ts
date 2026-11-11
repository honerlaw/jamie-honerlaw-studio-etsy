// RFC 8785 (JCS) canonical JSON for the values tool arguments can hold: object keys
// sorted by UTF-16 code units, no whitespace, numbers and strings as JSON.stringify
// writes them (JCS uses the same ECMAScript serialization). Undefined object members
// are dropped, as JSON.stringify drops them.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
