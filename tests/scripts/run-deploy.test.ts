import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunResult } from "../../scripts/lib/command-runner.ts";
import { runDeploy } from "../../scripts/deploy/run-deploy.ts";
import type { Call, Request } from "./support/fakes.ts";
import { captureOutput, fakeFetch, fakeRunner, json, ok } from "./support/fakes.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

const SECRETS = {
  ETSY_KEYSTRING: "keystring-value-1",
  ETSY_SHARED_SECRET: "shared-secret-value",
  ALLOWED_ETSY_USER_ID: "unset",
  ALLOWED_ETSY_SHOP_ID: "unset",
  // Not canonical JSON (spaces), so re-serializing it would change the bytes Wrangler uploads.
  TOKEN_ENC_KEYS: '{ "k1": "base64-key-material-xyz=" }',
  TOKEN_ENC_KID: "k1",
  MCP_CLIENTS: '[{"id":"claude","secret":"client-secret-abcdefgh"}]',
  UPLOAD_SIGNING_KEY: "upload-signing-key-1",
  CLOUDFLARE_API_TOKEN: "cf-api-token-value",
  CLOUDFLARE_ACCOUNT_ID: "acct123",
};
const WORKER_SECRET_NAMES = [
  "ETSY_KEYSTRING",
  "ETSY_SHARED_SECRET",
  "ALLOWED_ETSY_USER_ID",
  "ALLOWED_ETSY_SHOP_ID",
  "TOKEN_ENC_KEYS",
  "TOKEN_ENC_KID",
  "MCP_CLIENTS",
  "UPLOAD_SIGNING_KEY",
];
const DOPPLER_META = { DOPPLER_PROJECT: "etsy-shop-mcp", DOPPLER_CONFIG: "prd", DOPPLER_ENVIRONMENT: "prd" };
const ENV = {
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/deploy.yml@refs/heads/main",
  DOPPLER_TOKEN: "dp.st.prd.service-token",
  PATH: "/usr/bin",
  HOME: "/home/runner",
  CI: "true",
  UNRELATED: "must-not-leak",
};
const TOKEN_ID = "cf-token-id";
const OUTPUTS = { kv_namespace_ids: { value: { OAUTH_KV: "id-oauth", SHOP_KV: "id-shop" } } };

const dirs: string[] = [];
function dir(): string {
  const made = mkdtempSync(path.join(tmpdir(), "run-deploy-"));
  dirs.push(made);
  return made;
}
afterEach(() => {
  for (const made of dirs.splice(0)) {
    rmSync(made, { recursive: true, force: true });
  }
});

interface Seen {
  secretsFile?: string;
  secretsMode?: number;
  secretsContent?: unknown;
}

interface Setup {
  readonly secrets?: Record<string, string>;
  readonly plan?: unknown;
  readonly outputs?: unknown;
  readonly userVerify?: boolean;
  readonly accountVerify?: boolean;
  readonly wranglerCode?: number;
  readonly terraformFailure?: string;
}

function setup(options: Setup = {}): {
  readonly root: string;
  readonly tempRoot: string;
  readonly seen: Seen;
  readonly calls: Call[];
  readonly requests: Request[];
  readonly out: ReturnType<typeof captureOutput>;
  readonly deploy: (args?: readonly string[], env?: Record<string, string>) => Promise<number>;
} {
  const root = dir();
  const tempRoot = dir();
  copyFileSync(path.join(REPO, "wrangler.jsonc"), path.join(root, "wrangler.jsonc"));
  const seen: Seen = {};
  const { run, calls } = fakeRunner((call): RunResult => {
    if (call.command === "terraform") {
      const verb = call.args[1] ?? "";
      if (verb === options.terraformFailure) {
        return { code: 1, stdout: "" };
      }
      if (verb === "show") {
        return ok(JSON.stringify(options.plan ?? { resource_changes: [] }));
      }
      return ok(verb === "output" ? JSON.stringify(options.outputs ?? OUTPUTS) : "");
    }
    const file = call.args[call.args.indexOf("--secrets-file") + 1] ?? "";
    seen.secretsFile = file;
    seen.secretsMode = statSync(file).mode & 0o777;
    seen.secretsContent = JSON.parse(readFileSync(file, "utf8"));
    return { code: options.wranglerCode ?? 0, stdout: "" };
  });
  const { fetch, requests } = fakeFetch((request) => {
    if (request.url.startsWith("https://api.doppler.com/")) {
      return json({ ...(options.secrets ?? SECRETS), ...DOPPLER_META });
    }
    const user = request.url.endsWith("/user/tokens/verify");
    const active = user ? (options.userVerify ?? true) : (options.accountVerify ?? false);
    return active ? json({ success: true, result: { id: TOKEN_ID, status: "active" } }) : json({ success: false }, 401);
  });
  const out = captureOutput();
  return {
    root,
    tempRoot,
    seen,
    calls,
    requests,
    out,
    deploy: (args = [], env = ENV) => runDeploy({ env, args, fetch, run, out, root, tempRoot }),
  };
}

function everyPrinted(out: ReturnType<typeof captureOutput>): string {
  return [...out.lines, ...out.errors].join("\n");
}

describe("runDeploy guard", () => {
  it.each([
    ["outside GitHub Actions", { ...ENV, GITHUB_ACTIONS: "" }, "only in GitHub Actions"],
    [
      "from another workflow",
      { ...ENV, GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/ci.yml@refs/heads/main" },
      "deploy.yml",
    ],
    [
      "from another branch",
      { ...ENV, GITHUB_WORKFLOW_REF: "owner/repo/.github/workflows/deploy.yml@refs/heads/x" },
      "deploy.yml",
    ],
    ["without a Doppler token", { ...ENV, DOPPLER_TOKEN: "" }, "DOPPLER_TOKEN"],
  ])("refuses to run %s, touching nothing", async (_name, env, message) => {
    const harness = setup();
    expect(await harness.deploy([], env)).toBe(1);
    expect(harness.out.errors.join("\n")).toContain(message);
    expect(harness.calls).toStrictEqual([]);
    expect(harness.requests).toStrictEqual([]);
  });

  it("rejects an unknown argument before fetching anything", async () => {
    const harness = setup();
    expect(await harness.deploy(["--yolo"])).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("--yolo");
    expect(harness.requests).toStrictEqual([]);
  });
});

describe("runDeploy happy path", () => {
  it("masks, applies Terraform, then deploys with the secrets only in a 0600 file", async () => {
    const harness = setup();
    expect(await harness.deploy()).toBe(0);

    const [doppler] = harness.requests;
    expect(doppler?.url).toBe("https://api.doppler.com/v3/configs/config/secrets/download?format=json");
    expect(doppler?.headers["Authorization"]).toBe(`Bearer ${ENV.DOPPLER_TOKEN}`);

    const s3Secret = createHash("sha256").update(SECRETS.CLOUDFLARE_API_TOKEN).digest("hex");
    const masks = harness.out.lines.filter((line) => line.startsWith("::add-mask::")).map((line) => line.slice(12));
    expect(masks.sort()).toStrictEqual(
      [
        SECRETS.ETSY_KEYSTRING,
        SECRETS.ETSY_SHARED_SECRET,
        SECRETS.TOKEN_ENC_KEYS,
        "base64-key-material-xyz=",
        SECRETS.MCP_CLIENTS,
        "client-secret-abcdefgh",
        SECRETS.UPLOAD_SIGNING_KEY,
        SECRETS.CLOUDFLARE_API_TOKEN,
        s3Secret,
      ].sort(),
    );
    // Masks come before anything else is printed.
    expect(harness.out.lines.slice(0, masks.length).every((line) => line.startsWith("::add-mask::"))).toBe(true);

    expect(harness.calls.map((call) => [call.command, call.args[1]])).toStrictEqual([
      ["terraform", "init"],
      ["terraform", "plan"],
      ["terraform", "show"],
      ["terraform", "apply"],
      ["terraform", "output"],
      [path.join(harness.root, "node_modules", ".bin", "wrangler"), "--config"],
    ]);
    for (const call of harness.calls.slice(0, 5)) {
      expect(call.options.env).toStrictEqual({
        PATH: ENV.PATH,
        HOME: ENV.HOME,
        CI: ENV.CI,
        TF_IN_AUTOMATION: "1",
        TF_INPUT: "0",
        CLOUDFLARE_API_TOKEN: SECRETS.CLOUDFLARE_API_TOKEN,
        TF_VAR_account_id: SECRETS.CLOUDFLARE_ACCOUNT_ID,
        AWS_ACCESS_KEY_ID: TOKEN_ID,
        AWS_SECRET_ACCESS_KEY: s3Secret,
        AWS_ENDPOINT_URL_S3: "https://acct123.r2.cloudflarestorage.com",
      });
    }

    const wrangler = harness.calls[5];
    expect(wrangler?.args.slice(0, 4)).toStrictEqual(["deploy", "--config", "wrangler.deploy.json", "--secrets-file"]);
    expect(wrangler?.args).not.toContain("--var");
    expect(wrangler?.options.env).toStrictEqual({
      PATH: ENV.PATH,
      HOME: ENV.HOME,
      CI: ENV.CI,
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_API_TOKEN: SECRETS.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: SECRETS.CLOUDFLARE_ACCOUNT_ID,
    });
    expect(harness.seen.secretsMode).toBe(0o600);
    expect(harness.seen.secretsContent).toStrictEqual(
      Object.fromEntries(WORKER_SECRET_NAMES.map((name) => [name, SECRETS[name as keyof typeof SECRETS]])),
    );
    expect(existsSync(harness.seen.secretsFile ?? "")).toBe(false);
    expect(path.dirname(harness.seen.secretsFile ?? "").startsWith(harness.tempRoot)).toBe(true);

    const deployed = JSON.parse(readFileSync(path.join(harness.root, "wrangler.deploy.json"), "utf8")) as {
      readonly kv_namespaces: readonly unknown[];
      readonly main: string;
    };
    expect(deployed.kv_namespaces).toStrictEqual([
      { binding: "OAUTH_KV", id: "id-oauth" },
      { binding: "SHOP_KV", id: "id-shop" },
    ]);
    expect(deployed.main).toBe("src/index.ts");
    expect(harness.out.lines).toContain("KV namespace OAUTH_KV: id-oauth");
  });

  it("adds the bootstrap var only with --bootstrap", async () => {
    const harness = setup();
    expect(await harness.deploy(["--bootstrap"])).toBe(0);
    const wrangler = harness.calls.at(-1);
    expect(wrangler?.args.slice(-2)).toStrictEqual(["--var", "ALLOWLIST_BOOTSTRAP:true"]);
  });

  it("falls back to the account endpoint for an account-owned token", async () => {
    const harness = setup({ userVerify: false, accountVerify: true });
    expect(await harness.deploy()).toBe(0);
    expect(harness.requests.map((request) => request.url)).toContain(
      "https://api.cloudflare.com/client/v4/accounts/acct123/tokens/verify",
    );
  });
});

describe("runDeploy failures", () => {
  it("names missing secrets, prints no value and runs nothing", async () => {
    const rest = Object.fromEntries(
      Object.entries(SECRETS).filter(([name]) => name !== "ETSY_KEYSTRING" && name !== "CLOUDFLARE_ACCOUNT_ID"),
    );
    const harness = setup({ secrets: rest });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("ETSY_KEYSTRING, CLOUDFLARE_ACCOUNT_ID");
    expect(harness.calls).toStrictEqual([]);
    const printed = everyPrinted(harness.out).replaceAll(/::add-mask::.*/gu, "");
    for (const value of Object.values(rest).filter((value) => value.length >= 8 && value !== "unset")) {
      expect(printed).not.toContain(value);
    }
  });

  it("refuses a plan that deletes or replaces a resource", async () => {
    const plan = {
      resource_changes: [
        { address: "cloudflare_workers_kv_namespace.oauth", change: { actions: ["delete", "create"] } },
        { change: { actions: ["delete"] } },
        { address: "cloudflare_r2_bucket.uploads", change: { actions: ["no-op"] } },
      ],
    };
    const harness = setup({ plan });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("cloudflare_workers_kv_namespace.oauth, (unnamed resource)");
    expect(harness.calls.map((call) => call.args[1])).not.toContain("apply");
    expect(harness.calls.some((call) => call.command !== "terraform")).toBe(false);
  });

  it("applies a deleting plan when --allow-destroy is given", async () => {
    const plan = { resource_changes: [{ address: "x.y", change: { actions: ["delete"] } }] };
    const harness = setup({ plan });
    expect(await harness.deploy(["--allow-destroy"])).toBe(0);
    expect(harness.calls.map((call) => call.args[1])).toContain("apply");
  });

  it("deletes the secrets file even when wrangler fails", async () => {
    const harness = setup({ wranglerCode: 1 });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("wrangler deploy failed");
    expect(existsSync(harness.seen.secretsFile ?? "")).toBe(false);
  });

  it("stops when a Terraform step fails", async () => {
    const harness = setup({ terraformFailure: "plan" });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("terraform plan failed");
  });

  it("fails when the token does not verify either way", async () => {
    const harness = setup({ userVerify: false, accountVerify: false });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain("Workers R2 Storage Edit");
    expect(harness.calls).toStrictEqual([]);
  });

  it.each([
    ["no kv_namespace_ids output", {}, "kv_namespace_ids is missing"],
    ["a binding without an id", { kv_namespace_ids: { value: { OAUTH_KV: "id-oauth", SHOP_KV: 7 } } }, "SHOP_KV"],
  ])("fails before wrangler on %s", async (_name, outputs, message) => {
    const harness = setup({ outputs });
    expect(await harness.deploy()).toBe(1);
    expect(harness.out.errors.join("\n")).toContain(message);
    expect(harness.calls.some((call) => call.command !== "terraform")).toBe(false);
  });
});
