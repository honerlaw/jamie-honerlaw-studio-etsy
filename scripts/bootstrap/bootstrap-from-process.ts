import { randomBytes } from "node:crypto";
import path from "node:path";
import { spawnRunner } from "../lib/command-runner.ts";
import { processOutput } from "../lib/output.ts";
import { terminalPrompter } from "./prompt.ts";
import { runBootstrap } from "./run-bootstrap.ts";

/** `runBootstrap` wired to this process and terminal. */
export function bootstrapFromProcess(): Promise<number> {
  return runBootstrap({
    env: process.env,
    args: process.argv.slice(2),
    fetch: globalThis.fetch,
    run: spawnRunner(),
    out: processOutput(),
    prompt: terminalPrompter(process.stdin, process.stderr),
    random: randomBytes,
    root: path.resolve(import.meta.dirname, "..", ".."),
  });
}
