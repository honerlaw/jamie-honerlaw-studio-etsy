import type { CommandRunner } from "../lib/command-runner.ts";

/** The owner's logged-in GitHub CLI. Secret values go on stdin, never argv. */
export interface GitHub {
  readonly repo: () => Promise<string>;
  readonly api: (method: string, path: string, body?: unknown) => Promise<unknown>;
  readonly hasEnvSecret: (repo: string, environment: string, name: string) => Promise<boolean>;
  readonly setEnvSecret: (repo: string, environment: string, name: string, value: string) => Promise<void>;
}

export function ghCli(run: CommandRunner, cwd: string, env: Readonly<Record<string, string>>): GitHub {
  async function gh(args: readonly string[], what: string, stdin?: string): Promise<string> {
    const result = await run("gh", args, { env, cwd, capture: true, ...(stdin === undefined ? {} : { stdin }) });
    if (result.code !== 0) {
      throw new Error(`gh could not ${what} (exit ${String(result.code)}). Is \`gh auth login\` done?`);
    }
    return result.stdout;
  }

  return {
    repo: async () =>
      (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], "find the repo")).trim(),
    api: async (method, path, body) => {
      const args = ["api", "-X", method, path, ...(body === undefined ? [] : ["--input", "-"])];
      const text = await gh(args, `${method} ${path}`, body === undefined ? undefined : JSON.stringify(body));
      return text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
    },
    hasEnvSecret: async (repo, environment, name) => {
      const text = await gh(["secret", "list", "--env", environment, "--repo", repo, "--json", "name"], "list secrets");
      return (JSON.parse(text) as readonly { readonly name: string }[]).some((secret) => secret.name === name);
    },
    setEnvSecret: async (repo, environment, name, value) => {
      await gh(["secret", "set", name, "--env", environment, "--repo", repo], `set ${name}`, value);
    },
  };
}
