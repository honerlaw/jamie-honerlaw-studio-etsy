import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CommandRunner } from "../lib/command-runner.ts";

export interface WorkerDeploy {
  readonly run: CommandRunner;
  readonly root: string;
  /** Where the secrets file's private directory is made (RUNNER_TEMP in CI). */
  readonly tempRoot: string;
  readonly env: Readonly<Record<string, string>>;
  /** Exactly the `secrets.required` values, as the strings Doppler holds. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly bootstrap: boolean;
}

/**
 * Runs `wrangler deploy` with the Worker secrets in a mode-0600 JSON file that
 * is deleted afterwards, whatever happens. The secrets never go through argv or
 * the child's environment.
 */
export async function deployWorker(deploy: WorkerDeploy): Promise<void> {
  const dir = await mkdtemp(path.join(deploy.tempRoot, "worker-secrets-"));
  try {
    const file = path.join(dir, "secrets.json");
    await writeFile(file, JSON.stringify(deploy.secrets), { mode: 0o600 });
    const args = ["deploy", "--config", "wrangler.deploy.json", "--secrets-file", file];
    if (deploy.bootstrap) {
      args.push("--var", "ALLOWLIST_BOOTSTRAP:true");
    }
    const wrangler = path.join(deploy.root, "node_modules", ".bin", "wrangler");
    const result = await deploy.run(wrangler, args, { env: deploy.env, cwd: deploy.root });
    if (result.code !== 0) {
      throw new Error(`wrangler deploy failed (exit ${String(result.code)}).`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
