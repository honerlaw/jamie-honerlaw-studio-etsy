import type { RunResult } from "../../../scripts/lib/command-runner.ts";
import type { Call, Request } from "./fakes.ts";
import { json, ok } from "./fakes.ts";

const SLUG = "owner/repo";
export const BASE = `repos/${SLUG}/environments/production`;

/** Fake Doppler, GitHub and Cloudflare, sharing one mutable state. */
export class World {
  projectExists = true;
  readonly secrets: Record<string, string> = {};
  readonly policies: { id: number; name: string; type: string }[] = [];
  custom = false;
  readonly envSecrets: string[] = [];
  bucketStatus = 200;
  r2Ok = true;
  subdomain: unknown = "owner";
  ignorePost = false;
  ignoreDelete = false;
  dopplerDown = false;
  /** The Cloudflare token the fake accepts. */
  validToken = "cf-token";
  /** The Cloudflare account id the fake knows. */
  accountId = "acct";

  constructor(overrides: Partial<Omit<World, "doppler" | "gh" | "cloudflare">> = {}) {
    Object.assign(this, overrides);
  }

  doppler(call: Call): RunResult {
    const [group, verb] = call.args;
    if (this.dopplerDown) {
      return { code: 1, stdout: "" };
    }
    if (group === "projects") {
      if (verb === "get") {
        return this.projectExists ? ok("{}") : { code: 1, stdout: "" };
      }
      this.projectExists = true;
      return ok("{}");
    }
    if (group === "secrets" && verb === "download") {
      return ok(JSON.stringify({ ...this.secrets, DOPPLER_PROJECT: "etsy-shop-mcp", DOPPLER_CONFIG: "prd" }));
    }
    if (group === "secrets" && verb === "set") {
      this.secrets[call.args[2] ?? ""] = call.options.stdin ?? "";
      return ok();
    }
    return ok("dp.st.prd.new-token\n");
  }

  gh(call: Call): RunResult {
    const [group] = call.args;
    if (group === "repo") {
      return ok(`${SLUG}\n`);
    }
    if (group === "secret") {
      if (call.args[1] === "list") {
        return ok(JSON.stringify(this.envSecrets.map((name) => ({ name }))));
      }
      this.envSecrets.push(call.args[2] ?? "");
      return ok();
    }
    const method = call.args[2];
    const target = call.args[3] ?? "";
    const body = call.options.stdin === undefined ? undefined : (JSON.parse(call.options.stdin) as unknown);
    if (method === "PUT") {
      this.custom = (
        body as { deployment_branch_policy: { custom_branch_policies: boolean } }
      ).deployment_branch_policy.custom_branch_policies;
      return ok("{}");
    }
    if (method === "GET" && target === BASE) {
      return ok(JSON.stringify({ deployment_branch_policy: { custom_branch_policies: this.custom } }));
    }
    if (method === "GET") {
      return ok(JSON.stringify({ branch_policies: this.policies }));
    }
    if (method === "DELETE") {
      if (this.ignoreDelete) {
        return ok("");
      }
      const id = Number(target.split("/").at(-1));
      this.policies.splice(
        this.policies.findIndex((policy) => policy.id === id),
        1,
      );
      return ok("");
    }
    if (!this.ignorePost) {
      const posted = body as { name: string; type: string };
      this.policies.push({ id: 100 + this.policies.length, ...posted });
    }
    return ok("{}");
  }

  cloudflare(request: Request): Response {
    if (request.url.endsWith("/tokens/verify")) {
      return request.headers["Authorization"] === `Bearer ${this.validToken}`
        ? json({ success: true, result: { id: "tok", status: "active" } })
        : json({ success: false }, 401);
    }
    if (/\/accounts\/[^/]+$/u.test(request.url)) {
      return json({}, request.url.endsWith(`/accounts/${this.accountId}`) ? 200 : 404);
    }
    if (request.url.endsWith("/workers/subdomain")) {
      return this.subdomain === null ? json({}, 404) : json({ result: { subdomain: this.subdomain } });
    }
    if (request.url.endsWith("/r2/buckets") && request.method === "GET") {
      return json({}, this.r2Ok ? 200 : 403);
    }
    if (request.method === "POST") {
      return json({}, 200);
    }
    return json({}, this.bucketStatus);
  }
}
