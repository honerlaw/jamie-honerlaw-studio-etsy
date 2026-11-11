import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ETSY_SCOPES, TOOL_OPERATIONS } from "../src/auth/etsy-scopes";

interface Operation {
  readonly operationId?: string;
  readonly security?: readonly Record<string, readonly string[]>[];
}

const spec = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../etsy/openapi.json"), "utf8")) as {
  readonly paths: Record<string, Record<string, Operation>>;
};
const operations = new Map<string, Operation>();
for (const methods of Object.values(spec.paths)) {
  for (const operation of Object.values(methods)) {
    if (operation.operationId !== undefined) {
      operations.set(operation.operationId, operation);
    }
  }
}

describe("Etsy scopes", () => {
  it("names only operations that exist in the spec snapshot", () => {
    const unknown = Object.values(TOOL_OPERATIONS)
      .flat()
      .filter((id) => !operations.has(id));
    expect(unknown).toStrictEqual([]);
  });

  it("requests exactly the union of the scopes those operations require", () => {
    const required = new Set<string>();
    for (const id of Object.values(TOOL_OPERATIONS).flat()) {
      for (const requirement of operations.get(id)?.security ?? []) {
        for (const scope of requirement["oauth2"] ?? []) {
          required.add(scope);
        }
      }
    }
    expect([...required].sort()).toStrictEqual([...ETSY_SCOPES].sort());
  });
});
