import { spawn } from "node:child_process";

export type Env = Readonly<Record<string, string | undefined>>;

export interface RunOptions {
  /** The child's whole environment: nothing is inherited from this process. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** Written to the child's stdin, which is then closed. Secrets travel here, never in argv. */
  readonly stdin?: string;
  /** Capture stdout instead of streaming it to the log (stderr always streams). */
  readonly capture?: boolean;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
}

export type CommandRunner = (command: string, args: readonly string[], options: RunOptions) => Promise<RunResult>;

export function spawnRunner(): CommandRunner {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", options.capture === true ? "pipe" : "inherit", "inherit"],
      });
      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      child.on("error", (error) => {
        reject(new Error(`could not run ${command}: ${error.message}`));
      });
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
      });
      child.stdin?.end(options.stdin ?? "");
    });
}
