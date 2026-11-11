// One-time owner setup for the Deploy workflow. See README "Setting up the server".
import { bootstrapFromProcess } from "./bootstrap/bootstrap-from-process.ts";
import { runCli } from "./lib/run-cli.ts";

await runCli(import.meta, bootstrapFromProcess);
