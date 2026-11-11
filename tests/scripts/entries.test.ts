import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEnvironmentFromProcess } from "../../scripts/bootstrap/apply-environment-from-process.ts";
import { bootstrapFromProcess } from "../../scripts/bootstrap/bootstrap-from-process.ts";
import { USAGE } from "../../scripts/bootstrap/run-bootstrap.ts";
import { deployFromProcess } from "../../scripts/deploy/deploy-from-process.ts";
import { ghCli } from "../../scripts/bootstrap/gh-cli.ts";
import { captureOutput, fakeRunner, ok, rejectWith } from "./support/fakes.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
// A child env with no GITHUB_ACTIONS and no DOPPLER_TOKEN, whatever runs the tests.
const CHILD_ENV = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" };

function quietStreams() {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return { stdout, stderr };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("entry files", () => {
  it("are inert when imported", async () => {
    await import("../../scripts/deploy.ts");
    await import("../../scripts/bootstrap.ts");
    await import("../../scripts/apply-environment.ts");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("deploy.ts refuses to run outside the Deploy workflow", () => {
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts", "deploy.ts")], {
      env: CHILD_ENV,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only in GitHub Actions");
  });

  it("bootstrap.ts --help prints usage", () => {
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts", "bootstrap.ts"), "--help"], {
      env: CHILD_ENV,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: npm run bootstrap");
  });

  it("apply-environment.ts fails cleanly when gh cannot run", () => {
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts", "apply-environment.ts")], {
      env: { PATH: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not run gh");
  });
});

describe("process wiring", () => {
  it.each([["/runner/temp"], [undefined]])(
    "deployFromProcess refuses outside Actions (RUNNER_TEMP %s)",
    async (temp) => {
      vi.stubEnv("GITHUB_ACTIONS", "");
      vi.stubEnv("RUNNER_TEMP", temp);
      const { stderr } = quietStreams();
      expect(await deployFromProcess()).toBe(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain("only in GitHub Actions");
    },
  );

  it("bootstrapFromProcess prints usage for --help", async () => {
    const { stdout } = quietStreams();
    vi.spyOn(process, "argv", "get").mockReturnValue(["node", "bootstrap.ts", "--help"]);
    expect(await bootstrapFromProcess()).toBe(0);
    expect(stdout).toHaveBeenCalledWith(`${USAGE}\n`);
  });

  it("applyEnvironmentFromProcess applies the spec through gh", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "apply-env-"));
    try {
      mkdirSync(path.join(root, ".github", "environments"), { recursive: true });
      writeFileSync(
        path.join(root, ".github", "environments", "production.json"),
        JSON.stringify({
          name: "production",
          deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
          branch_policies: [{ name: "main", type: "branch" }],
        }),
      );
      const { run } = fakeRunner((call) => {
        if (call.args[0] === "repo") {
          return ok("o/r\n");
        }
        if (call.args[2] === "GET" && call.args[3] === "repos/o/r/environments/production") {
          return ok('{"deployment_branch_policy":{"custom_branch_policies":true}}');
        }
        return ok(call.args[2] === "GET" ? '{"branch_policies":[{"id":1,"name":"main","type":"branch"}]}' : "");
      });
      const out = captureOutput();
      expect(await applyEnvironmentFromProcess(root, ghCli(run, root, {}), out)).toBe(0);
      expect(out.lines).toStrictEqual([
        "The production environment of o/r matches .github/environments/production.json.",
      ]);

      writeFileSync(path.join(root, ".github", "environments", "production.json"), "{}");
      expect(await applyEnvironmentFromProcess(root, ghCli(run, root, {}), out)).toBe(1);
      expect(out.errors[0]).toContain("environment spec");

      const thrower = { ...ghCli(run, root, {}), repo: () => rejectWith("raw") };
      writeFileSync(
        path.join(root, ".github", "environments", "production.json"),
        JSON.stringify({
          name: "production",
          deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
          branch_policies: [],
        }),
      );
      expect(await applyEnvironmentFromProcess(root, thrower, out)).toBe(1);
      expect(out.errors[1]).toBe("raw");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applyEnvironmentFromProcess defaults to the repo and the real gh", async () => {
    vi.stubEnv("PATH", "");
    const { stderr } = quietStreams();
    expect(await applyEnvironmentFromProcess()).toBe(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("could not run gh");
  });
});
