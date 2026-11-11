import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnRunner } from "../lib/command-runner.ts";
import { processOutput } from "../lib/output.ts";
import { applyEnvironment, parseEnvironmentSpec } from "./apply-environment.ts";
import { ghCli } from "./gh-cli.ts";

/** Re-applies .github/environments/production.json alone (the bootstrap also does this). */
export async function applyEnvironmentFromProcess(
  root = path.resolve(import.meta.dirname, "..", ".."),
  gh = ghCli(
    spawnRunner(),
    root,
    Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  ),
  out = processOutput(),
): Promise<number> {
  try {
    const spec = parseEnvironmentSpec(
      await readFile(path.join(root, ".github", "environments", "production.json"), "utf8"),
    );
    const repo = await gh.repo();
    await applyEnvironment(gh, repo, spec);
    out.line(`The ${spec.name} environment of ${repo} matches .github/environments/production.json.`);
    return 0;
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
