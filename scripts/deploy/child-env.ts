import type { Env } from "../lib/command-runner.ts";

// Each child gets an explicit allowlist, never this process's environment, so no
// Worker secret and no DOPPLER_TOKEN reaches Terraform, its providers or Wrangler.

const PASSED_THROUGH = ["PATH", "HOME", "CI"] as const;

function passThrough(env: Env): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of PASSED_THROUGH) {
    const value = env[name];
    if (value !== undefined) {
      picked[name] = value;
    }
  }
  return picked;
}

export interface TerraformCredentials {
  readonly apiToken: string;
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export function terraformEnv(env: Env, credentials: TerraformCredentials): Record<string, string> {
  return {
    ...passThrough(env),
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    CLOUDFLARE_API_TOKEN: credentials.apiToken,
    TF_VAR_account_id: credentials.accountId,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_ENDPOINT_URL_S3: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
  };
}

export function wranglerEnv(env: Env, apiToken: string, accountId: string): Record<string, string> {
  return {
    ...passThrough(env),
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
}
