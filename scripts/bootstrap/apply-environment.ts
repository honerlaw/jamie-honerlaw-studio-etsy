import type { GitHub } from "./gh-cli.ts";

// GitHub creates a missing environment, unprotected, the first time a job names
// it. So the committed policy is applied every time, never "only if missing", and
// read back before anything trusts it.

export interface EnvironmentSpec {
  readonly name: string;
  readonly deployment_branch_policy: { readonly protected_branches: false; readonly custom_branch_policies: true };
  readonly branch_policies: readonly { readonly name: string; readonly type: "branch" }[];
}

interface BranchPolicy {
  readonly id: number;
  readonly name: string;
  readonly type?: string;
}

export function parseEnvironmentSpec(text: string): EnvironmentSpec {
  const spec = JSON.parse(text) as {
    readonly name?: unknown;
    readonly deployment_branch_policy?: {
      readonly protected_branches?: unknown;
      readonly custom_branch_policies?: unknown;
    };
    readonly branch_policies?: unknown;
  };
  const policy = spec.deployment_branch_policy;
  if (
    typeof spec.name !== "string" ||
    policy?.protected_branches !== false ||
    policy.custom_branch_policies !== true ||
    !Array.isArray(spec.branch_policies)
  ) {
    throw new Error("environment spec: needs name, custom branch policies and a branch_policies list");
  }
  return spec as EnvironmentSpec;
}

async function branchPolicies(gh: GitHub, base: string): Promise<BranchPolicy[]> {
  const body = (await gh.api("GET", `${base}/deployment-branch-policies`)) as {
    readonly branch_policies?: readonly BranchPolicy[];
  };
  return [...(body.branch_policies ?? [])];
}

function key(policy: { readonly name: string; readonly type?: string }): string {
  return `${policy.type ?? "branch"}:${policy.name}`;
}

/** Creates or updates the environment, makes its branch policies exactly the spec's, and verifies. */
export async function applyEnvironment(gh: GitHub, repo: string, spec: EnvironmentSpec): Promise<void> {
  const base = `repos/${repo}/environments/${spec.name}`;
  await gh.api("PUT", base, { deployment_branch_policy: spec.deployment_branch_policy });
  const wanted = new Set(spec.branch_policies.map(key));
  const current = await branchPolicies(gh, base);
  for (const policy of current.filter((existing) => !wanted.has(key(existing)))) {
    await gh.api("DELETE", `${base}/deployment-branch-policies/${String(policy.id)}`);
  }
  const have = new Set(current.map(key));
  for (const policy of spec.branch_policies.filter((wantedPolicy) => !have.has(key(wantedPolicy)))) {
    await gh.api("POST", `${base}/deployment-branch-policies`, { name: policy.name, type: policy.type });
  }

  const environment = (await gh.api("GET", base)) as {
    readonly deployment_branch_policy?: { readonly custom_branch_policies?: unknown } | null;
  };
  const after = (await branchPolicies(gh, base)).map(key).sort();
  if (
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    JSON.stringify(after) !== JSON.stringify([...wanted].sort())
  ) {
    throw new Error(
      `The ${spec.name} environment did not end up limited to ${[...wanted].join(", ")} (found ${after.length === 0 ? "none" : after.join(", ")}). ` +
        "Nothing was stored in it.",
    );
  }
}
