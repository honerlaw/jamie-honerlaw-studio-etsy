import { describe, expect, it, vi } from "vitest";
import { parseEnvironmentSpec } from "../../scripts/bootstrap/apply-environment.ts";
import { dopplerCli } from "../../scripts/bootstrap/doppler-cli.ts";
import { generateMissing } from "../../scripts/bootstrap/generate-secrets.ts";
import { ghCli } from "../../scripts/bootstrap/gh-cli.ts";
import { terraformEnv, wranglerEnv } from "../../scripts/deploy/child-env.ts";
import { withKvIds } from "../../scripts/deploy/deploy-config.ts";
import { fetchDopplerSecrets } from "../../scripts/deploy/doppler-secrets.ts";
import { maskablePieces, maskCommands } from "../../scripts/deploy/mask-values.ts";
import { plannedDeletions } from "../../scripts/deploy/plan-guard.ts";
import { cloudflareTokenId, r2Credentials } from "../../scripts/lib/cloudflare-token.ts";
import { processOutput } from "../../scripts/lib/output.ts";
import { runCli } from "../../scripts/lib/run-cli.ts";
import { parseWranglerConfig } from "../../scripts/lib/wrangler-config.ts";
import { fakeFetch, fakeRunner, json, ok } from "./support/fakes.ts";

describe("parseWranglerConfig", () => {
  it("reads secrets.required and KV bindings from JSONC", () => {
    const config = parseWranglerConfig(`{
      // comment
      "secrets": { "required": ["A", "B"] },
      "kv_namespaces": [{ "binding": "X" }, { "binding": "Y" }],
    }`);
    expect(config.requiredSecrets).toStrictEqual(["A", "B"]);
    expect(config.kvBindings).toStrictEqual(["X", "Y"]);
  });

  it.each([
    ["not an object", "[1]", "not a valid JSONC object"],
    ["invalid JSONC", "{", "not a valid JSONC object"],
    ["no secrets", '{"kv_namespaces": []}', "secrets.required must be a list of strings"],
    ["non-string secret", '{"secrets": {"required": [1]}, "kv_namespaces": []}', "secrets.required"],
    ["no kv list", '{"secrets": {"required": []}}', "kv_namespaces must be a list"],
    ["bad binding", '{"secrets": {"required": []}, "kv_namespaces": [3]}', "kv_namespaces[].binding"],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseWranglerConfig(text)).toThrow(message);
  });
});

describe("masking", () => {
  it("splits lines, walks JSON leaves and skips short or placeholder pieces", () => {
    expect(maskablePieces("first-line-x\r\nsecond-line")).toStrictEqual(["first-line-x", "second-line"]);
    expect(maskablePieces('{"a":["leaf-value-1",{"b":"leaf-value-2"}],"n":12345678,"s":"short"}')).toStrictEqual([
      '{"a":["leaf-value-1",{"b":"leaf-value-2"}],"n":12345678,"s":"short"}',
      "leaf-value-1",
      "leaf-value-2",
    ]);
    expect(maskablePieces("unset")).toStrictEqual([]);
    expect(maskablePieces('"a-json-string"')).toStrictEqual(['"a-json-string"']);
    expect(maskablePieces("null")).toStrictEqual([]);
  });

  it("escapes % and deduplicates across values", () => {
    expect(maskCommands(["100%-secret", "100%-secret"])).toStrictEqual(["::add-mask::100%25-secret"]);
    expect(maskCommands(['{"k":"a\\rb\\ncdefgh"}'])).toStrictEqual([
      '::add-mask::{"k":"a\\rb\\ncdefgh"}',
      "::add-mask::a%0Db%0Acdefgh",
    ]);
  });
});

describe("fetchDopplerSecrets", () => {
  it.each([
    ["an HTTP error", json({}, 401), "HTTP 401"],
    ["a non-object body", json([1]), "something other than a JSON object"],
    ["a null body", json(null), "something other than a JSON object"],
    ["a non-string value", json({ A: 1 }), "Doppler secret A is not a string."],
  ])("rejects %s", async (_name, response, message) => {
    const { fetch } = fakeFetch(() => response);
    await expect(fetchDopplerSecrets(fetch, "t")).rejects.toThrow(message);
  });
});

describe("cloudflareTokenId", () => {
  it("rejects an inactive token or a missing id", async () => {
    const inactive = fakeFetch(() => json({ success: true, result: { id: "x", status: "disabled" } }));
    await expect(cloudflareTokenId(inactive.fetch, "t", "a")).rejects.toThrow("did not verify");
    const noResult = fakeFetch(() => json({ success: true, result: null }));
    await expect(cloudflareTokenId(noResult.fetch, "t", "a")).rejects.toThrow("did not verify");
    const noId = fakeFetch(() => json({ success: true, result: { status: "active" } }));
    await expect(cloudflareTokenId(noId.fetch, "t", "a")).rejects.toThrow("did not verify");
  });

  it("derives R2 credentials from the token", () => {
    // SHA-256("abc"), the FIPS 180-2 test vector.
    const SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(r2Credentials("id", "abc")).toStrictEqual({ accessKeyId: "id", secretAccessKey: SHA256_OF_ABC });
  });
});

describe("generateMissing", () => {
  const random = (size: number): Buffer => Buffer.alloc(size, 1);

  it("reuses the first existing key id and generates nothing already present", () => {
    expect(generateMissing({ TOKEN_ENC_KEYS: '{"k7":"x","k8":"y"}' }, random)["TOKEN_ENC_KID"]).toBe("k7");
    const all = {
      TOKEN_ENC_KEYS: "{}",
      TOKEN_ENC_KID: "k1",
      UPLOAD_SIGNING_KEY: "u",
      MCP_CLIENTS: "[]",
      ALLOWED_ETSY_USER_ID: "1",
      ALLOWED_ETSY_SHOP_ID: "2",
    };
    expect(generateMissing(all, random)).toStrictEqual({});
  });

  it("fails on keys with no id when it has to pick one", () => {
    expect(() => generateMissing({ TOKEN_ENC_KEYS: "{}" }, random)).toThrow("has no key id");
  });

  it("generates both MCP clients with their redirect URIs", () => {
    const clients = JSON.parse(generateMissing({}, random)["MCP_CLIENTS"] ?? "") as { id: string; secret: string }[];
    expect(clients.map((client) => client.id)).toStrictEqual(["claude", "chatgpt"]);
    expect(clients[0]?.secret).toBe(Buffer.alloc(32, 1).toString("base64"));
  });
});

describe("parseEnvironmentSpec", () => {
  it.each([
    ["{}"],
    [
      '{"name":"p","deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":true},"branch_policies":[]}',
    ],
    [
      '{"name":"p","deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":false},"branch_policies":[]}',
    ],
    ['{"name":"p","deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'],
  ])("rejects %s", (text) => {
    expect(() => parseEnvironmentSpec(text)).toThrow("environment spec");
  });
});

describe("CLI wrappers", () => {
  it("creates the Doppler project only when it is missing", async () => {
    const { run, calls } = fakeRunner((call) => (call.args[1] === "get" ? { code: 1, stdout: "" } : ok()));
    await dopplerCli(run, "/r", {}).ensureProject();
    expect(calls.map((call) => call.args.slice(0, 2))).toStrictEqual([
      ["projects", "get"],
      ["projects", "create"],
    ]);
  });

  it("returns undefined for an empty gh api body and sends a body on stdin", async () => {
    const { run, calls } = fakeRunner(() => ok("  \n"));
    const gh = ghCli(run, "/r", {});
    expect(await gh.api("DELETE", "x")).toBeUndefined();
    expect(await gh.api("POST", "y", { a: 1 })).toBeUndefined();
    expect(calls[1]?.args).toStrictEqual(["api", "-X", "POST", "y", "--input", "-"]);
    expect(calls[1]?.options.stdin).toBe('{"a":1}');
  });

  it("explains a gh failure", async () => {
    const { run } = fakeRunner(() => ({ code: 4, stdout: "" }));
    await expect(ghCli(run, "/r", {}).repo()).rejects.toThrow("Is `gh auth login` done?");
  });
});

describe("child environments", () => {
  it("pass through only PATH, HOME and CI, and only when set", () => {
    expect(wranglerEnv({ PATH: "/bin", SECRET: "x" }, "t", "a")).toStrictEqual({
      PATH: "/bin",
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "a",
    });
    expect(
      Object.keys(terraformEnv({}, { apiToken: "t", accountId: "a", accessKeyId: "k", secretAccessKey: "s" })),
    ).not.toContain("PATH");
  });
});

describe("small helpers", () => {
  it("fills KV ids and names a missing one", () => {
    expect(withKvIds({ kv_namespaces: [{ binding: "A" }] }, { A: "1" })).toStrictEqual({
      kv_namespaces: [{ binding: "A", id: "1" }],
    });
    expect(() => withKvIds({ kv_namespaces: [{ binding: "B" }] }, {})).toThrow("binding B");
  });

  it("finds deletions in a plan without resource changes", () => {
    expect(plannedDeletions("{}")).toStrictEqual([]);
    expect(plannedDeletions('{"resource_changes":[{"address":"a"},{"change":{"actions":"delete"}}]}')).toStrictEqual(
      [],
    );
  });

  it("runCli runs main only for the entry module and sets the exit code", async () => {
    const main = vi.fn(() => Promise.resolve(3));
    const setExitCode = vi.fn();
    await runCli({ main: false }, main, setExitCode);
    expect(main).not.toHaveBeenCalled();
    await runCli({ main: true }, main, setExitCode);
    expect(setExitCode).toHaveBeenCalledWith(3);

    const before = process.exitCode;
    await runCli({ main: true }, () => Promise.resolve(0));
    expect(process.exitCode).toBe(0);
    process.exitCode = before;
  });

  it("processOutput writes lines to stdout and stderr", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = processOutput();
    out.line("hello");
    out.error("oops");
    expect(stdout).toHaveBeenCalledWith("hello\n");
    expect(stderr).toHaveBeenCalledWith("oops\n");
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
