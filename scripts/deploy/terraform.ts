import type { CommandRunner } from "../lib/command-runner.ts";
import type { Output } from "../lib/output.ts";
import { plannedDeletions } from "./plan-guard.ts";

export interface InfraRun {
  readonly run: CommandRunner;
  readonly out: Output;
  readonly root: string;
  readonly env: Readonly<Record<string, string>>;
  readonly allowDestroy: boolean;
}

async function terraform(infra: InfraRun, verb: string, args: readonly string[], capture = false): Promise<string> {
  const result = await infra.run("terraform", ["-chdir=infra", verb, ...args], {
    env: infra.env,
    cwd: infra.root,
    capture,
  });
  if (result.code !== 0) {
    throw new Error(`terraform ${verb} failed (exit ${String(result.code)}).`);
  }
  return result.stdout;
}

function kvIds(outputJson: string): Record<string, string> {
  const outputs = JSON.parse(outputJson) as { readonly kv_namespace_ids?: { readonly value?: unknown } };
  const value = outputs.kv_namespace_ids?.value;
  if (typeof value !== "object" || value === null) {
    throw new Error("Terraform output kv_namespace_ids is missing.");
  }
  const ids: Record<string, string> = {};
  for (const [binding, id] of Object.entries(value)) {
    if (typeof id === "string") {
      ids[binding] = id;
    }
  }
  return ids;
}

/** Plans, refuses deletions unless allowed, applies, and returns the KV namespace ids by binding. */
export async function applyInfra(infra: InfraRun): Promise<Record<string, string>> {
  await terraform(infra, "init", ["-input=false", "-lockfile=readonly"]);
  await terraform(infra, "plan", ["-input=false", "-lock-timeout=5m", "-out=tfplan"]);
  const deletions = plannedDeletions(await terraform(infra, "show", ["-json", "tfplan"], true));
  if (deletions.length > 0 && !infra.allowDestroy) {
    throw new Error(
      `The Terraform plan deletes or replaces ${deletions.join(", ")}. Nothing was applied. ` +
        "Fix the change, or dispatch the Deploy workflow with allow_destroy if this is intended.",
    );
  }
  await terraform(infra, "apply", ["-input=false", "-lock-timeout=5m", "tfplan"]);
  const ids = kvIds(await terraform(infra, "output", ["-json"], true));
  for (const [binding, id] of Object.entries(ids)) {
    infra.out.line(`KV namespace ${binding}: ${id}`);
  }
  return ids;
}
