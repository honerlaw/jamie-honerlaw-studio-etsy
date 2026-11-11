import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");

interface Job {
  readonly needs?: readonly string[];
  readonly if?: string;
}

interface Workflow {
  readonly on: Record<string, unknown>;
  readonly jobs: Record<string, Job>;
}

function loadCi(): Workflow {
  return parse(readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as Workflow;
}

describe("ci.yml structure", () => {
  it("ci-pass needs every other job, so no job can escape the gate", () => {
    const { jobs } = loadCi();
    const otherJobs = Object.keys(jobs).filter((id) => id !== "ci-pass");
    expect([...(jobs["ci-pass"]?.needs ?? [])].sort()).toStrictEqual(otherJobs.sort());
  });

  it("ci-pass always runs and only the gate jobs are unconditional", () => {
    const { jobs } = loadCi();
    expect(jobs["ci-pass"]?.if).toBe("always()");
    const conditional = Object.entries(jobs)
      .filter(([id, job]) => id !== "ci-pass" && job.if !== undefined)
      .map(([id]) => id);
    expect(conditional).toStrictEqual([]);
  });

  it("runs on every pull request with no path filters", () => {
    const { on } = loadCi();
    expect(on["pull_request"]).toBeNull();
  });
});
