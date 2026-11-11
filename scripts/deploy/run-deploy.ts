import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cloudflareTokenId, r2Credentials } from "../lib/cloudflare-token.ts";
import type { CommandRunner, Env } from "../lib/command-runner.ts";
import type { Output } from "../lib/output.ts";
import { parseWranglerConfig } from "../lib/wrangler-config.ts";
import { terraformEnv, wranglerEnv } from "./child-env.ts";
import { withKvIds } from "./deploy-config.ts";
import { deployRefusal } from "./deploy-guard.ts";
import { fetchDopplerSecrets } from "./doppler-secrets.ts";
import { maskCommands } from "./mask-values.ts";
import { applyInfra } from "./terraform.ts";
import { deployWorker } from "./wrangler-deploy.ts";

export interface DeployDeps {
  readonly env: Env;
  readonly args: readonly string[];
  readonly fetch: typeof fetch;
  readonly run: CommandRunner;
  readonly out: Output;
  readonly root: string;
  readonly tempRoot: string;
}

const FLAGS = new Set(["--bootstrap", "--allow-destroy"]);
const PIPELINE_SECRETS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

/** The named secrets' values, and which of them Doppler lacks. */
function pick<Name extends string>(
  secrets: Readonly<Record<string, string>>,
  names: readonly Name[],
): { readonly values: Record<Name, string>; readonly missing: Name[] } {
  const values: Partial<Record<Name, string>> = {};
  const missing: Name[] = [];
  for (const name of names) {
    const value = secrets[name];
    if (value === undefined) {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }
  return { values: values as Record<Name, string>, missing };
}

async function deploy(deps: DeployDeps, token: string): Promise<void> {
  const unknown = deps.args.filter((arg) => !FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")}. Allowed: ${[...FLAGS].join(", ")}.`);
  }
  const config = parseWranglerConfig(await readFile(path.join(deps.root, "wrangler.jsonc"), "utf8"));
  const secrets = await fetchDopplerSecrets(deps.fetch, token);
  const masked = [...config.requiredSecrets, "CLOUDFLARE_API_TOKEN"].flatMap((name) => secrets[name] ?? []);
  for (const command of maskCommands(masked)) {
    deps.out.line(command);
  }
  const worker = pick(secrets, config.requiredSecrets);
  const pipeline = pick(secrets, PIPELINE_SECRETS);
  const missing = [...worker.missing, ...pipeline.missing];
  if (missing.length > 0) {
    throw new Error(`Doppler is missing ${missing.join(", ")}. Nothing was deployed.`);
  }
  const { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId } = pipeline.values;
  const r2 = r2Credentials(await cloudflareTokenId(deps.fetch, apiToken, accountId), apiToken);
  for (const command of maskCommands([r2.secretAccessKey])) {
    deps.out.line(command);
  }
  const ids = await applyInfra({
    run: deps.run,
    out: deps.out,
    root: deps.root,
    env: terraformEnv(deps.env, { apiToken, accountId, ...r2 }),
    allowDestroy: deps.args.includes("--allow-destroy"),
  });
  await writeFile(
    path.join(deps.root, "wrangler.deploy.json"),
    `${JSON.stringify(withKvIds(config.raw, ids), null, 2)}\n`,
  );
  await deployWorker({
    run: deps.run,
    root: deps.root,
    tempRoot: deps.tempRoot,
    env: wranglerEnv(deps.env, apiToken, accountId),
    secrets: worker.values,
    bootstrap: deps.args.includes("--bootstrap"),
  });
}

/** The whole deploy: guard, secrets, Terraform, Wrangler. Returns the process exit code. */
export async function runDeploy(deps: DeployDeps): Promise<number> {
  const refusal = deployRefusal(deps.env);
  if (refusal !== undefined) {
    deps.out.error(refusal);
    return 1;
  }
  try {
    await deploy(deps, deps.env["DOPPLER_TOKEN"] ?? "");
    deps.out.line("Deployed.");
    return 0;
  } catch (error) {
    deps.out.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
