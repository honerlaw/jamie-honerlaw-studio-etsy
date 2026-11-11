// Production deploy, run only by .github/workflows/deploy.yml. See .minerva/reference/deploy.md.
import { deployFromProcess } from "./deploy/deploy-from-process.ts";
import { runCli } from "./lib/run-cli.ts";

await runCli(import.meta, deployFromProcess);
