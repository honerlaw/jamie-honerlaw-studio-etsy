import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap, USAGE } from "../../scripts/bootstrap/run-bootstrap.ts";
import { BASE, World } from "./support/bootstrap-world.ts";
import { captureOutput, fakeFetch, fakeRunner, rejectWith } from "./support/fakes.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

const dirs: string[] = [];
afterEach(() => {
  for (const made of dirs.splice(0)) {
    rmSync(made, { recursive: true, force: true });
  }
});

async function repoRoot(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "run-bootstrap-"));
  dirs.push(root);
  mkdirSync(path.join(root, ".github", "environments"), { recursive: true });
  await copyFile(
    path.join(REPO, ".github", "environments", "production.json"),
    path.join(root, ".github", "environments", "production.json"),
  );
  return root;
}

async function harness(state: World, answers: Record<string, string> = {}) {
  const root = await repoRoot();
  const { run, calls } = fakeRunner((call) => (call.command === "doppler" ? state.doppler(call) : state.gh(call)));
  const { fetch, requests } = fakeFetch((request) => state.cloudflare(request));
  const out = captureOutput();
  const asked: string[] = [];
  const answer = (label: string): Promise<string> => {
    asked.push(label);
    return Promise.resolve(answers[label] ?? "");
  };
  let counter = 0;
  const random = (size: number): Buffer => Buffer.alloc(size, ++counter);
  return {
    calls,
    requests,
    out,
    asked,
    bootstrap: (args: readonly string[] = []) =>
      runBootstrap({
        env: { PATH: "/usr/bin", UNSET: undefined },
        args,
        fetch,
        run,
        out,
        prompt: { secret: answer, visible: answer },
        random,
        root,
      }),
  };
}

const ANSWERS = {
  "Cloudflare API token": "cf-token",
  "Cloudflare account id": "acct",
  "Etsy app keystring": "keystring",
  "Etsy app shared secret": "shared",
};

describe("runBootstrap", () => {
  it("prints usage for --help and rejects unknown arguments", async () => {
    const state = new World();
    const help = await harness(state);
    expect(await help.bootstrap(["--help"])).toBe(0);
    expect(help.out.lines).toStrictEqual([USAGE]);
    expect(help.calls).toStrictEqual([]);

    const bad = await harness(state);
    expect(await bad.bootstrap(["--force"])).toBe(2);
    expect(bad.out.errors.join("")).toContain("--force");
    expect(bad.calls).toStrictEqual([]);
  });

  it("sets up everything on a fresh account without printing a secret", async () => {
    const state = new World({
      projectExists: false,
      bucketStatus: 404,
      policies: [{ id: 7, name: "dev", type: "branch" }],
    });
    const run = await harness(state, ANSWERS);
    expect(await run.bootstrap()).toBe(0);

    expect(run.asked).toStrictEqual(Object.keys(ANSWERS));
    // The token is verified before the prerequisite checks, which come before the state bucket.
    expect(
      run.requests.map((request) => `${request.method} ${request.url.replace(/^.*\/client\/v4/u, "")}`),
    ).toStrictEqual([
      "GET /user/tokens/verify",
      "GET /accounts/acct",
      "GET /accounts/acct/r2/buckets",
      "GET /accounts/acct/workers/subdomain",
      "GET /accounts/acct/r2/buckets/etsy-shop-mcp-tfstate",
      "POST /accounts/acct/r2/buckets",
    ]);
    // The unprotected environment is switched to custom policies and the extra policy deleted.
    const apiCalls = run.calls
      .filter((call) => call.args[0] === "api")
      .map((call) => `${call.args[2] ?? ""} ${call.args[3] ?? ""}`);
    expect(apiCalls).toStrictEqual([
      `PUT ${BASE}`,
      `GET ${BASE}/deployment-branch-policies`,
      `DELETE ${BASE}/deployment-branch-policies/7`,
      `POST ${BASE}/deployment-branch-policies`,
      `GET ${BASE}`,
      `GET ${BASE}/deployment-branch-policies`,
    ]);
    expect(Object.keys(state.secrets).sort()).toStrictEqual(
      [
        "ALLOWED_ETSY_SHOP_ID",
        "ALLOWED_ETSY_USER_ID",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "ETSY_KEYSTRING",
        "ETSY_SHARED_SECRET",
        "MCP_CLIENTS",
        "TOKEN_ENC_KEYS",
        "TOKEN_ENC_KID",
        "UPLOAD_SIGNING_KEY",
      ].sort(),
    );
    expect(state.secrets["CLOUDFLARE_API_TOKEN"]).toBe("cf-token");
    expect(state.policies.map((policy) => policy.name)).toStrictEqual(["main"]);
    expect(state.custom).toBe(true);
    expect(state.envSecrets).toStrictEqual(["DOPPLER_TOKEN"]);

    const setToken = run.calls.find((call) => call.command === "gh" && call.args[1] === "set");
    expect(setToken?.options.stdin).toBe("dp.st.prd.new-token");
    expect(setToken?.args).not.toContain("dp.st.prd.new-token");
    for (const call of run.calls) {
      expect(call.options.capture).toBe(true);
      expect(call.options.env).toStrictEqual({ PATH: "/usr/bin" });
      for (const value of Object.values(state.secrets).filter((value) => value !== "unset")) {
        expect(call.args).not.toContain(value);
      }
    }
    const printed = [...run.out.lines, ...run.out.errors].join("\n");
    for (const value of [...Object.values(state.secrets).filter((value) => value !== "unset"), "dp.st.prd.new-token"]) {
      expect(printed).not.toContain(value);
    }
    expect(run.out.lines).toContain("Created the etsy-shop-mcp-tfstate R2 bucket for Terraform state.");
    expect(run.out.lines.at(-1)).toBe("Bootstrap complete. Next: gh workflow run deploy.yml -f bootstrap=true");
    expect(run.requests.find((request) => request.method === "POST")?.body).toBe('{"name":"etsy-shop-mcp-tfstate"}');
  });

  it("is idempotent: a second run asks nothing and replaces nothing", async () => {
    const state = new World({ bucketStatus: 404 });
    expect(await (await harness(state, ANSWERS)).bootstrap()).toBe(0);
    const before = { ...state.secrets };
    state.bucketStatus = 200;

    const again = await harness(state);
    expect(await again.bootstrap()).toBe(0);
    expect(again.asked).toStrictEqual([]);
    expect(state.secrets).toStrictEqual(before);
    expect(state.envSecrets).toStrictEqual(["DOPPLER_TOKEN"]);
    expect(again.calls.some((call) => call.args[0] === "configs")).toBe(false);
    expect(again.calls.some((call) => call.args[0] === "secrets" && call.args[1] === "set")).toBe(false);
    // The state bucket exists, so it is checked and not created again.
    expect(
      again.requests.map((request) => `${request.method} ${request.url.replace(/^.*\/client\/v4/u, "")}`),
    ).toStrictEqual([
      "GET /user/tokens/verify",
      "GET /accounts/acct",
      "GET /accounts/acct/r2/buckets",
      "GET /accounts/acct/workers/subdomain",
      "GET /accounts/acct/r2/buckets/etsy-shop-mcp-tfstate",
    ]);
    expect(again.out.lines.some((line) => line.startsWith("Created the etsy-shop-mcp-tfstate"))).toBe(false);
  });

  it("stores a typed Cloudflare token only after it verifies, so a typo is asked for again", async () => {
    const state = new World();
    const typo = await harness(state, { ...ANSWERS, "Cloudflare API token": "cf-tokne" });
    expect(await typo.bootstrap()).toBe(1);
    expect(typo.out.errors.join("")).toContain("did not verify as an active token");
    expect(typo.out.errors.join("")).not.toContain("came from Doppler");
    expect(state.secrets).toStrictEqual({});

    const retry = await harness(state, ANSWERS);
    expect(await retry.bootstrap()).toBe(0);
    expect(retry.asked.slice(0, 2)).toStrictEqual(["Cloudflare API token", "Cloudflare account id"]);
    expect(state.secrets["CLOUDFLARE_API_TOKEN"]).toBe("cf-token");
  });

  it("says how to replace a stored Cloudflare value that fails", async () => {
    const state = new World({ subdomain: "" });
    state.secrets["CLOUDFLARE_API_TOKEN"] = "cf-token";
    const run = await harness(state, ANSWERS);
    expect(await run.bootstrap()).toBe(1);
    expect(run.out.errors.join("")).toContain(
      "CLOUDFLARE_API_TOKEN came from Doppler; replace a wrong value with `doppler secrets set <NAME> --project etsy-shop-mcp --config prd`.",
    );
    expect(state.secrets["CLOUDFLARE_ACCOUNT_ID"]).toBeUndefined();
  });

  it("creates a new service token with --rotate-doppler-token", async () => {
    const state = new World();
    expect(await (await harness(state, ANSWERS)).bootstrap()).toBe(0);
    const rotate = await harness(state);
    expect(await rotate.bootstrap(["--rotate-doppler-token"])).toBe(0);
    expect(state.envSecrets).toStrictEqual(["DOPPLER_TOKEN", "DOPPLER_TOKEN"]);
  });

  it("stops before storing the token when the environment does not end up main-only", async () => {
    const state = new World({ ignorePost: true });
    const run = await harness(state, ANSWERS);
    expect(await run.bootstrap()).toBe(1);
    expect(run.out.errors.join("")).toContain("did not end up limited to branch:main (found none)");
    expect(state.envSecrets).toStrictEqual([]);
  });

  it("names the extra policy when one is left behind", async () => {
    const state = new World({ ignoreDelete: true, policies: [{ id: 2, name: "v*", type: "tag" }] });
    const run = await harness(state, ANSWERS);
    expect(await run.bootstrap()).toBe(1);
    expect(run.out.errors.join("")).toContain("(found branch:main, tag:v*)");
    expect(state.envSecrets).toStrictEqual([]);
  });

  it.each([
    ["an empty required answer", {}, {}, "CLOUDFLARE_API_TOKEN is required."],
    ["an unknown account id", { accountId: "other" }, ANSWERS, "Cloudflare account acct was not found"],
    ["R2 not enabled", { r2Ok: false }, ANSWERS, "R2 is not enabled"],
    ["no workers.dev subdomain", { subdomain: "" }, ANSWERS, "no workers.dev subdomain"],
    ["a failed subdomain lookup", { subdomain: null }, ANSWERS, "no workers.dev subdomain"],
    [
      "an unreadable state bucket",
      { bucketStatus: 500 },
      ANSWERS,
      "Could not check the etsy-shop-mcp-tfstate bucket (HTTP 500)",
    ],
    ["Doppler not logged in", { dopplerDown: true }, ANSWERS, "Is `doppler login` done?"],
  ])("fails with a clear message on %s", async (_name, overrides, answers, message) => {
    const run = await harness(new World(overrides), answers);
    expect(await run.bootstrap()).toBe(1);
    expect(run.out.errors.join("")).toContain(message);
  });

  it("reports a non-Error throw as text", async () => {
    const out = captureOutput();
    const code = await runBootstrap({
      env: {},
      args: [],
      fetch: () => Promise.reject(new Error("unused")),
      run: () => rejectWith("doppler vanished"),
      out,
      prompt: { secret: () => Promise.resolve(""), visible: () => Promise.resolve("") },
      random: (size) => Buffer.alloc(size),
      root: await repoRoot(),
    });
    expect(code).toBe(1);
    expect(out.errors).toStrictEqual(["doppler vanished"]);
  });
});
