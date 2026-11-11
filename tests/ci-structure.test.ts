import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "..");

interface Step {
  readonly run?: string;
  readonly "continue-on-error"?: unknown;
}

interface Job {
  readonly needs?: readonly string[];
  readonly if?: string;
  readonly "continue-on-error"?: unknown;
  readonly steps?: readonly Step[];
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

  it("never lets a failure count as success", () => {
    const { jobs } = loadCi();
    for (const [id, job] of Object.entries(jobs)) {
      expect(job["continue-on-error"], `job ${id}`).toBeUndefined();
      for (const step of job.steps ?? []) {
        expect(step["continue-on-error"], `a step in ${id}`).toBeUndefined();
        expect(step.run ?? "", `a step in ${id}`).not.toMatch(/\|\|\s*(true|:|exit 0)\b/u);
      }
    }
  });

  it("runs each gate's command in its job", () => {
    const { jobs } = loadCi();
    const expected: Record<string, readonly string[]> = {
      typecheck: ["npm run typecheck"],
      lint: ["npm run lint"],
      format: ["npm run format:check"],
      knip: ["npm run knip"],
      test: ["npm test"],
      build: ["npm run build"],
      "generated-types-match": ["npm run check:etsy-types", "npm run check:worker-types"],
      "secret-scan": ["/tmp/gitleaks git"],
    };
    for (const [id, commands] of Object.entries(expected)) {
      const runs = (jobs[id]?.steps ?? []).map((step) => step.run ?? "");
      for (const command of commands) {
        expect(
          runs.some((run) => run.trim().startsWith(command)),
          `${id} runs ${command}`,
        ).toBe(true);
      }
    }
  });

  it("runs on every pull request with no path filters", () => {
    const { on } = loadCi();
    expect(on["pull_request"]).toBeNull();
  });
});
