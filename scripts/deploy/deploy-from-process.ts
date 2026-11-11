import { tmpdir } from "node:os";
import path from "node:path";
import { spawnRunner } from "../lib/command-runner.ts";
import { processOutput } from "../lib/output.ts";
import { runDeploy } from "./run-deploy.ts";

/** `runDeploy` wired to this process: its env and argv, real fetch, spawn and output. */
export function deployFromProcess(): Promise<number> {
  return runDeploy({
    env: process.env,
    args: process.argv.slice(2),
    fetch: globalThis.fetch,
    run: spawnRunner(),
    out: processOutput(),
    root: path.resolve(import.meta.dirname, "..", ".."),
    tempRoot: process.env["RUNNER_TEMP"] ?? tmpdir(),
  });
}
