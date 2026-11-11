// Per-file coverage floor. Vitest enforces the global 90% lines/branches
// thresholds; this enforces that no single file in src/ drops below 80%, so a
// weak file cannot hide behind the average. Reads coverage/coverage-summary.json
// (the istanbul `json-summary` reporter) written by `vitest run --coverage`.
import { readFileSync } from "node:fs";
import path from "node:path";

const FLOOR = 80;
const METRICS = ["lines", "branches"];

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
const failures = [];

for (const [file, metrics] of Object.entries(summary)) {
  if (file === "total") {
    continue;
  }
  for (const metric of METRICS) {
    const { pct, total } = metrics[metric];
    // A file with no branches reports pct 100 (istanbul convention) — nothing to miss.
    if (total > 0 && pct < FLOOR) {
      failures.push(`${path.relative(process.cwd(), file)}: ${metric} ${pct}% < ${FLOOR}%`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Per-file coverage floor (${FLOOR}%) not met:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log(`Every file in src/ meets the ${FLOOR}% per-file coverage floor.`);
}
