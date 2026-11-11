import { describe, expect, it } from "vitest";
import { spawnRunner } from "../../scripts/lib/command-runner.ts";

const env = { PATH: process.env["PATH"] ?? "" };
const cwd = process.cwd();

describe("spawnRunner", () => {
  it("captures stdout, feeds stdin and passes only the given env", async () => {
    const run = spawnRunner();
    const result = await run(
      process.execPath,
      [
        "-e",
        "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{process.stdout.write(s+'|'+(process.env.SECRET_X??'none'));process.exit(3)})",
      ],
      { env, cwd, stdin: "fed", capture: true },
    );
    expect(result).toStrictEqual({ code: 3, stdout: "fed|none" });
  });

  it("streams stdout when not capturing and closes an empty stdin", async () => {
    const result = await spawnRunner()(process.execPath, ["-e", "process.stdin.resume().on('end',()=>{})"], {
      env,
      cwd,
    });
    expect(result).toStrictEqual({ code: 0, stdout: "" });
  });

  it("reports a signal kill as exit 1", async () => {
    const result = await spawnRunner()(process.execPath, ["-e", "process.kill(process.pid,'SIGKILL')"], { env, cwd });
    expect(result.code).toBe(1);
  });

  it("rejects when the command cannot be started", async () => {
    await expect(spawnRunner()("definitely-not-a-command-xyz", [], { env, cwd })).rejects.toThrow(
      "could not run definitely-not-a-command-xyz",
    );
  });
});
