import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The check scripts are gates themselves, so prove each one can fail.

const ROOT = path.resolve(import.meta.dirname, "..");
const workDirs: string[] = [];

function workDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "check-scripts-"));
  workDirs.push(dir);
  return dir;
}

function runScript(script: string, args: readonly string[]): number {
  const result = spawnSync("node", [path.join(ROOT, "scripts", script), ...args], { cwd: ROOT, encoding: "utf8" });
  return result.status ?? -1;
}

function writeSummary(entries: Record<string, unknown>): string {
  const file = path.join(workDir(), "coverage-summary.json");
  writeFileSync(file, JSON.stringify({ total: {}, ...entries }));
  return file;
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-coverage-floor.mjs", () => {
  const covered = { lines: { pct: 95, total: 20 }, branches: { pct: 100, total: 0 } };

  it("passes when every file meets the floor", () => {
    expect(runScript("check-coverage-floor.mjs", [writeSummary({ "/src/a.ts": covered })])).toBe(0);
  });

  it("fails when one file is under the floor", () => {
    const weak = { lines: { pct: 79.9, total: 10 }, branches: { pct: 100, total: 2 } };
    expect(runScript("check-coverage-floor.mjs", [writeSummary({ "/src/a.ts": covered, "/src/b.ts": weak })])).toBe(1);
  });

  it("fails closed on a non-numeric coverage value", () => {
    const unknown = { lines: { pct: "Unknown", total: 0 }, branches: { pct: 100, total: 0 } };
    expect(runScript("check-coverage-floor.mjs", [writeSummary({ "/src/a.ts": unknown })])).toBe(1);
  });

  it("fails when the summary lists no files", () => {
    expect(runScript("check-coverage-floor.mjs", [writeSummary({})])).toBe(1);
  });
});

describe("check-etsy-types.mjs", () => {
  it("passes for the committed types", () => {
    expect(runScript("check-etsy-types.mjs", [])).toBe(0);
  });

  it("fails when the committed types are stale", () => {
    const stale = path.join(workDir(), "schema.ts");
    writeFileSync(
      stale,
      `${readFileSync(path.join(ROOT, "src", "etsy", "generated", "schema.ts"), "utf8")}\n// edited\n`,
    );
    expect(runScript("check-etsy-types.mjs", ["etsy/openapi.json", stale])).toBe(1);
  });
});
