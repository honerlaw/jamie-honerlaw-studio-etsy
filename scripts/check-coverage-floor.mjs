// Per-file coverage floor. Vitest enforces the global 90% lines/branches
// thresholds; this enforces that no covered file (src/ and scripts/**/*.ts)
// drops below 80%, so a weak file cannot hide behind the average. Reads coverage/coverage-summary.json
// (the istanbul `json-summary` reporter) written by `vitest run --coverage`, or
// the path given as the first argument (used by tests/coverage-floor.test.ts).
import { readFileSync } from "node:fs";
import path from "node:path";

const FLOOR = 80;
const METRICS = ["lines", "branches"];

const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json";
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const failures = [];
const fileEntries = Object.keys(summary).filter((file) => file !== "total");
if (fileEntries.length === 0) {
  failures.push("coverage summary lists no files");
}

for (const [file, metrics] of Object.entries(summary)) {
  if (file === "total") {
    continue;
  }
  for (const metric of METRICS) {
    const { pct, total } = metrics[metric] ?? {};
    // Fail closed on a shape we don't understand (e.g. pct "Unknown"), so a
    // reporter change can never turn this gate into a silent pass.
    if (typeof pct !== "number" || typeof total !== "number") {
      failures.push(`${path.relative(process.cwd(), file)}: ${metric} has no numeric coverage (${String(pct)})`);
      continue;
    }
    // A file with no branches reports pct 100 (istanbul convention): nothing to miss.
    if (total > 0 && pct < FLOOR) {
      failures.push(`${path.relative(process.cwd(), file)}: ${metric} ${pct}% < ${FLOOR}%`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Per-file coverage floor (${FLOOR}%) not met:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log(`Every covered file meets the ${FLOOR}% per-file coverage floor.`);
}
