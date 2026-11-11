// Fails when src/etsy/generated/schema.ts differs from what openapi-typescript
// generates from the committed snapshot etsy/openapi.json. It does NOT detect
// upstream drift in Etsy's live spec; .github/workflows/etsy-spec-drift.yml does.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const committedPath = "src/etsy/generated/schema.ts";
const workDir = mkdtempSync(path.join(tmpdir(), "etsy-types-"));
const freshPath = path.join(workDir, "schema.ts");

try {
  execFileSync("npx", ["openapi-typescript", "etsy/openapi.json", "-o", freshPath], { stdio: "pipe" });
  const committed = readFileSync(committedPath, "utf8");
  const fresh = readFileSync(freshPath, "utf8");
  if (committed !== fresh) {
    console.error(`${committedPath} is stale. Run \`npm run gen:etsy-types\` and commit the result.`);
    process.exitCode = 1;
  } else {
    console.log(`${committedPath} matches etsy/openapi.json.`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
