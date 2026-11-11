import type { CommandRunner } from "../lib/command-runner.ts";

export const DOPPLER_PROJECT = "etsy-shop-mcp";
export const DOPPLER_CONFIG = "prd";
const SCOPE = ["--project", DOPPLER_PROJECT, "--config", DOPPLER_CONFIG] as const;

/** The owner's logged-in Doppler CLI. Output is always captured, so no secret value is printed. */
export interface Doppler {
  readonly ensureProject: () => Promise<void>;
  readonly secrets: () => Promise<Record<string, string>>;
  readonly set: (name: string, value: string) => Promise<void>;
  readonly createServiceToken: () => Promise<string>;
}

export function dopplerCli(run: CommandRunner, cwd: string, env: Readonly<Record<string, string>>): Doppler {
  async function doppler(args: readonly string[], what: string, stdin?: string): Promise<string> {
    const result = await run("doppler", args, { env, cwd, capture: true, ...(stdin === undefined ? {} : { stdin }) });
    if (result.code !== 0) {
      throw new Error(`doppler could not ${what} (exit ${String(result.code)}). Is \`doppler login\` done?`);
    }
    return result.stdout;
  }

  return {
    ensureProject: async () => {
      const found = await run("doppler", ["projects", "get", DOPPLER_PROJECT, "--json"], { env, cwd, capture: true });
      if (found.code !== 0) {
        await doppler(["projects", "create", DOPPLER_PROJECT, "--json"], `create project ${DOPPLER_PROJECT}`);
      }
    },
    secrets: async () => {
      const text = await doppler(["secrets", "download", ...SCOPE, "--no-file", "--format", "json"], "read secrets");
      const all = JSON.parse(text) as Record<string, string>;
      return Object.fromEntries(Object.entries(all).filter(([name]) => !name.startsWith("DOPPLER_")));
    },
    set: async (name, value) => {
      await doppler(["secrets", "set", name, ...SCOPE], `set ${name}`, value);
    },
    createServiceToken: async () => {
      const token = await doppler(
        ["configs", "tokens", "create", "github-actions-deploy", ...SCOPE, "--access", "read", "--plain"],
        "create a service token",
      );
      return token.trim();
    },
  };
}
