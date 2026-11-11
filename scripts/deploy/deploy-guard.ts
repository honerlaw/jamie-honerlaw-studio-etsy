import type { Env } from "../lib/command-runner.ts";

// The deploy workflow on main is the only Terraform writer, which is what makes
// the workflow's concurrency group the state lock. This check stops an
// accidental local or wrong-workflow run; it is not enforcement (anyone can set
// these variables). What actually keeps CI the only writer is that no
// DOPPLER_TOKEN exists outside the `production` environment.
const WORKFLOW_REF = /^[^/]+\/[^/]+\/\.github\/workflows\/deploy\.yml@refs\/heads\/main$/u;

/** Why this run must not deploy, or undefined when it may. */
export function deployRefusal(env: Env): string | undefined {
  if (env["GITHUB_ACTIONS"] !== "true") {
    return "Deploys run only in GitHub Actions (the Deploy workflow). There is no local deploy path.";
  }
  if (!WORKFLOW_REF.test(env["GITHUB_WORKFLOW_REF"] ?? "")) {
    return "Deploys run only from .github/workflows/deploy.yml on refs/heads/main.";
  }
  if ((env["DOPPLER_TOKEN"] ?? "") === "") {
    return "DOPPLER_TOKEN is not set.";
  }
  return undefined;
}
