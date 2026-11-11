import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Pins the shape of the production deploy (.minerva/reference/deploy.md). The
// deploy script's own behaviour is tested in tests/scripts/run-deploy.test.ts.

const ROOT = path.resolve(import.meta.dirname, "..");

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
}

interface Job {
  readonly if?: string;
  readonly needs?: unknown;
  readonly environment?: unknown;
  readonly concurrency?: unknown;
  readonly outputs?: Record<string, string>;
  readonly steps: readonly Step[];
}

interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly concurrency?: unknown;
  readonly jobs: Record<string, Job>;
}

function text(file: string): string {
  return readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8");
}

function load(file: string): Workflow {
  return parse(text(file)) as Workflow;
}

const deploy = load("deploy.yml");
const gateJob = deploy.jobs["gate"];
const job = deploy.jobs["deploy"];
const gate = gateJob?.steps.find((step) => step.id === "gate");
const steps = job?.steps ?? [];
const ready = steps.find((step) => step.id === "ready");
const deployStep = steps.find((step) => step.run?.includes("node scripts/deploy.ts") === true);
const allSteps = [...(gateJob?.steps ?? []), ...steps];

function stepText(step: Step | undefined): string {
  return JSON.stringify(step ?? {});
}

describe("deploy.yml", () => {
  it("runs after CI succeeds on a push to main, or on a dispatch of main", () => {
    expect(Object.keys(deploy.on).sort()).toStrictEqual(["workflow_dispatch", "workflow_run"]);
    expect(deploy.on["workflow_run"]).toStrictEqual({ workflows: ["CI"], types: ["completed"], branches: ["main"] });
    const dispatch = deploy.on["workflow_dispatch"] as { readonly inputs: Record<string, Record<string, unknown>> };
    expect(Object.keys(dispatch.inputs).sort()).toStrictEqual(["allow_destroy", "bootstrap"]);
    for (const input of Object.values(dispatch.inputs)) {
      expect(input["type"]).toBe("boolean");
      expect(input["default"]).toBe(false);
    }
    expect(Object.keys(deploy.jobs)).toStrictEqual(["gate", "deploy"]);
    expect(gateJob?.if).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(gateJob?.if).toContain(
      "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'",
    );
  });

  it("uses the production environment, read-only permissions and one deploy at a time", () => {
    expect(job?.environment).toBe("production");
    expect(gateJob?.environment).toBeUndefined();
    expect(deploy.permissions).toStrictEqual({ contents: "read", checks: "read" });
    // Only the deploying job joins the group, so a run the gate turns away can
    // never cancel a pending deploy of the tip.
    expect(deploy.concurrency).toBeUndefined();
    expect(gateJob?.concurrency).toBeUndefined();
    expect(job?.concurrency).toStrictEqual({ group: "deploy", "cancel-in-progress": false });
    expect(job?.needs).toBe("gate");
    expect(job?.if).toBe("needs.gate.outputs.deploy == 'true'");
    expect(gateJob?.outputs).toStrictEqual({
      deploy: "${{ steps.gate.outputs.deploy }}",
      sha: "${{ steps.gate.outputs.sha }}",
    });
  });

  it("deploys only the tip of main, and a dispatch only once ci-pass succeeded there", () => {
    const script = gate?.run ?? "";
    expect(script).toContain('gh api "repos/$REPO/commits/main" --jq .sha');
    expect(script).toContain(
      [
        'if [ "$tip" != "$SHA" ]; then',
        '  if [ "$EVENT" = "workflow_dispatch" ]; then',
        '    echo "::warning::$SHA is no longer the tip of main ($tip), so this dispatch does not deploy. Dispatch again from main."',
        "  else",
        '    echo "::notice::$SHA is no longer the tip of main ($tip), so it is not deployed."',
        "  fi",
        '  echo "deploy=false" >> "$GITHUB_OUTPUT"',
        "  exit 0",
        "fi",
      ].join("\n"),
    );
    expect(script).toContain(
      [
        '  if [ "$conclusion" != "success" ]; then',
        "    echo \"::error::ci-pass has not succeeded on $SHA (found '${conclusion}'), so it is not deployed.\"",
        "    exit 1",
        "  fi",
      ].join("\n"),
    );
    expect(script.indexOf('"$tip" != "$SHA"')).toBeLessThan(script.indexOf('echo "deploy=true"'));
    expect(script.indexOf('"$conclusion" != "success"')).toBeLessThan(script.indexOf('echo "deploy=true"'));
    expect(script).toContain("check_name=ci-pass");
    expect(script).toContain("select(.app.id == 15368)");
    expect(script).toContain('if [ "$conclusion" != "success" ]');
    expect(gateJob?.steps).toStrictEqual([gate]);
  });

  it("re-checks the tip in the deploy job and skips with a warning when DOPPLER_TOKEN is absent", () => {
    // "Re-run failed jobs" reuses the gate's outputs, so the deploy job checks the tip itself.
    expect(steps[0]).toBe(ready);
    const script = ready?.run ?? "";
    expect(script).toContain('gh api "repos/$REPO/commits/main" --jq .sha');
    // The stale branch must fail closed: write deploy=false and stop.
    expect(script).toContain(
      [
        'if [ "$tip" != "$SHA" ]; then',
        '  echo "::warning::$SHA is no longer the tip of main ($tip), so it is not deployed. If this was a re-run, it may have displaced a pending deploy of the tip: run gh workflow run deploy.yml."',
        '  echo "deploy=false" >> "$GITHUB_OUTPUT"',
        "  exit 0",
        "fi",
      ].join("\n"),
    );
    expect(script.indexOf('"$tip" != "$SHA"')).toBeLessThan(script.indexOf('echo "deploy=true"'));
    expect(script).toContain("::warning::DOPPLER_TOKEN is not set");
    expect(ready?.env).toStrictEqual({
      HAS_TOKEN: "${{ secrets.DOPPLER_TOKEN != '' }}",
      SHA: "${{ needs.gate.outputs.sha }}",
      GH_TOKEN: "${{ github.token }}",
      REPO: "${{ github.repository }}",
    });
    const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@") === true);
    expect(checkout?.with).toStrictEqual({ ref: "${{ needs.gate.outputs.sha }}", "persist-credentials": false });
    for (const step of steps.filter((candidate) => candidate !== ready)) {
      expect(step.if, stepText(step)).toBe("steps.ready.outputs.deploy == 'true'");
    }
  });

  it("references DOPPLER_TOKEN only in its presence check and the deploy step, github.token only in the tip checks", () => {
    const secretRefs = [...text("deploy.yml").matchAll(/secrets\.[A-Za-z_]+/gu)].map((match) => match[0]);
    expect(new Set(secretRefs)).toStrictEqual(new Set(["secrets.DOPPLER_TOKEN"]));
    const withSecret = allSteps.filter((step) => stepText(step).includes("secrets."));
    expect(withSecret).toStrictEqual([ready, deployStep]);
    expect(deployStep?.env?.["DOPPLER_TOKEN"]).toBe("${{ secrets.DOPPLER_TOKEN }}");
    const withToken = allSteps.filter((step) => stepText(step).includes("github.token"));
    expect(withToken).toStrictEqual([gate, ready]);
  });

  it("runs the deploy script directly, with dispatch inputs only via env", () => {
    expect(deployStep?.run).toContain('node scripts/deploy.ts "${args[@]}"');
    expect(Object.keys(deployStep?.env ?? {}).sort()).toStrictEqual(["ALLOW_DESTROY", "BOOTSTRAP", "DOPPLER_TOKEN"]);
    for (const step of allSteps) {
      expect(step.run ?? "", stepText(step)).not.toContain("${{");
    }
    expect(text("deploy.yml")).not.toContain("npm run deploy");
  });

  it("names no Worker secret", () => {
    const wrangler = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    const required = [...wrangler.matchAll(/"([A-Z][A-Z_]+)",?\n/gu)].map((match) => match[1] ?? "");
    expect(required).toContain("MCP_CLIENTS");
    for (const name of required) {
      expect(text("deploy.yml")).not.toContain(name);
    }
  });
});

describe.each(["ci.yml", "deploy.yml"])("%s actions", (file) => {
  const all = Object.values(load(file).jobs).flatMap((candidate) => candidate.steps);

  it("pins every action by full commit SHA", () => {
    for (const step of all.filter((candidate) => candidate.uses !== undefined)) {
      expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
    }
  });

  it("installs Terraform 1.14.7 without the wrapper", () => {
    const terraform = all.filter((step) => step.uses?.startsWith("hashicorp/setup-terraform@") === true);
    expect(terraform).toHaveLength(1);
    expect(terraform[0]?.with).toStrictEqual({ terraform_version: "1.14.7", terraform_wrapper: false });
  });
});
