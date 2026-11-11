import { readFile } from "node:fs/promises";
import path from "node:path";
import { cloudflareTokenId } from "../lib/cloudflare-token.ts";
import type { CommandRunner, Env } from "../lib/command-runner.ts";
import type { Output } from "../lib/output.ts";
import { applyEnvironment, parseEnvironmentSpec } from "./apply-environment.ts";
import { checkPrerequisites, ensureStateBucket, STATE_BUCKET } from "./cloudflare-setup.ts";
import { dopplerCli, DOPPLER_CONFIG, DOPPLER_PROJECT } from "./doppler-cli.ts";
import type { RandomBytes } from "./generate-secrets.ts";
import { generateMissing } from "./generate-secrets.ts";
import { ghCli } from "./gh-cli.ts";
import type { Prompter } from "./prompt.ts";

export interface BootstrapDeps {
  readonly env: Env;
  readonly args: readonly string[];
  readonly fetch: typeof fetch;
  readonly run: CommandRunner;
  readonly out: Output;
  readonly prompt: Prompter;
  readonly random: RandomBytes;
  readonly root: string;
}

export const USAGE = `Usage: npm run bootstrap [-- --rotate-doppler-token]

One-time, idempotent setup for the Deploy workflow (README, "Setting up the server"):
Doppler project ${DOPPLER_PROJECT}/${DOPPLER_CONFIG} and its secrets, the ${STATE_BUCKET} R2 bucket,
the GitHub "production" environment (main only) and its DOPPLER_TOKEN.
Needs \`doppler login\` and \`gh auth login\` first. It never prints or overwrites a secret.`;

const ENVIRONMENT = "production";

function definedEnv(env: Env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

async function bootstrap(deps: BootstrapDeps, rotateToken: boolean): Promise<void> {
  const env = definedEnv(deps.env);
  const doppler = dopplerCli(deps.run, deps.root, env);
  const gh = ghCli(deps.run, deps.root, env);

  await doppler.ensureProject();
  const secrets = await doppler.secrets();
  const ensure = async (name: string, ask: () => Promise<string>): Promise<string> => {
    const existing = secrets[name];
    if (existing !== undefined) {
      return existing;
    }
    const value = await ask();
    if (value === "") {
      throw new Error(`${name} is required.`);
    }
    await doppler.set(name, value);
    secrets[name] = value;
    deps.out.line(`Stored ${name} in Doppler.`);
    return value;
  };

  // The Cloudflare token and account id are checked before they are stored, so a
  // mistyped value is asked for again on the next run instead of being reused.
  const answered = new Map<string, string>();
  const collect = async (name: string, ask: () => Promise<string>): Promise<string> => {
    const value = secrets[name] ?? (await ask());
    if (value === "") {
      throw new Error(`${name} is required.`);
    }
    if (secrets[name] === undefined) {
      answered.set(name, value);
    }
    return value;
  };
  const token = await collect("CLOUDFLARE_API_TOKEN", () => deps.prompt.secret("Cloudflare API token"));
  const accountId = await collect("CLOUDFLARE_ACCOUNT_ID", () => deps.prompt.visible("Cloudflare account id"));
  const account = { fetch: deps.fetch, token, accountId };
  try {
    await cloudflareTokenId(deps.fetch, token, accountId);
    await checkPrerequisites(account);
  } catch (error) {
    const stored = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter((name) => !answered.has(name));
    if (stored.length === 0) {
      throw error;
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ${stored.join(" and ")} came from Doppler; ` +
        `replace a wrong value with \`doppler secrets set <NAME> --project ${DOPPLER_PROJECT} --config ${DOPPLER_CONFIG}\`.`,
      { cause: error },
    );
  }
  for (const [name, value] of answered) {
    await ensure(name, () => Promise.resolve(value));
  }

  for (const [name, value] of Object.entries(generateMissing(secrets, deps.random))) {
    await ensure(name, () => Promise.resolve(value));
  }
  await ensure("ETSY_KEYSTRING", () => deps.prompt.secret("Etsy app keystring"));
  await ensure("ETSY_SHARED_SECRET", () => deps.prompt.secret("Etsy app shared secret"));

  if (await ensureStateBucket(account)) {
    deps.out.line(`Created the ${STATE_BUCKET} R2 bucket for Terraform state.`);
  }

  const repo = await gh.repo();
  const spec = parseEnvironmentSpec(
    await readFile(path.join(deps.root, ".github", "environments", "production.json"), "utf8"),
  );
  await applyEnvironment(gh, repo, spec);
  deps.out.line(`The ${ENVIRONMENT} environment of ${repo} accepts deployments from main only.`);

  if (rotateToken || !(await gh.hasEnvSecret(repo, ENVIRONMENT, "DOPPLER_TOKEN"))) {
    await gh.setEnvSecret(repo, ENVIRONMENT, "DOPPLER_TOKEN", await doppler.createServiceToken());
    deps.out.line(`Stored a new read-only Doppler service token as ${ENVIRONMENT}'s DOPPLER_TOKEN.`);
  }
  deps.out.line("Bootstrap complete. Next: gh workflow run deploy.yml -f bootstrap=true");
}

/** One-time setup. Returns the process exit code. */
export async function runBootstrap(deps: BootstrapDeps): Promise<number> {
  if (deps.args.includes("--help")) {
    deps.out.line(USAGE);
    return 0;
  }
  const unknown = deps.args.filter((arg) => arg !== "--rotate-doppler-token");
  if (unknown.length > 0) {
    deps.out.error(`Unknown argument(s): ${unknown.join(" ")}\n\n${USAGE}`);
    return 2;
  }
  try {
    await bootstrap(deps, deps.args.includes("--rotate-doppler-token"));
    return 0;
  } catch (error) {
    deps.out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
