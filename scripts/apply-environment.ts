// Applies .github/environments/production.json (deployments from main only).
import { applyEnvironmentFromProcess } from "./bootstrap/apply-environment-from-process.ts";
import { runCli } from "./lib/run-cli.ts";

await runCli(import.meta, applyEnvironmentFromProcess);
