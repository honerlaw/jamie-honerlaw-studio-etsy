import { AuthorizationError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it, vi } from "vitest";

import { authorizationFailure } from "../src/auth/authorization-failure";
import { readCookie } from "../src/auth/read-cookie";
import { revokeUserGrants } from "../src/auth/revoke-user-grants";
import { logEvent } from "../src/log/log-event";
import { escapeHtml } from "../src/pages/escape-html";
import { htmlPage } from "../src/pages/html-page";
import { withAccessToken } from "../src/tools/with-access-token";
import { toolDeps } from "./support/tool-deps";

describe("readCookie", () => {
  it("matches the exact name, not a prefix or a value substring", () => {
    const request = new Request("https://x.example", { headers: { cookie: "a-long=1; a=2=3; junk" } });
    expect(readCookie(request, "a")).toBe("2=3");
    expect(readCookie(request, "a-lo")).toBeUndefined();
    expect(readCookie(new Request("https://x.example"), "a")).toBeUndefined();
  });
});

describe("authorizationFailure", () => {
  it("redirects only when the library validated where to", () => {
    const error = new AuthorizationError("invalid_scope", {
      description: "bad scope",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      state: "s",
    });
    const response = authorizationFailure(error);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=invalid_scope");
  });

  it("rethrows anything that isn't an authorization failure", () => {
    expect(() => authorizationFailure(new TypeError("bug"))).toThrow(TypeError);
  });
});

describe("revokeUserGrants", () => {
  it("revokes every grant across pages", async () => {
    const revoked: string[] = [];
    const oauth = {
      listUserGrants: (_user: string, options?: { cursor?: string }) =>
        Promise.resolve(
          options?.cursor === undefined
            ? { items: [{ id: "g1" }, { id: "g2" }], cursor: "next" }
            : { items: [{ id: "g3" }] },
        ),
      revokeGrant: (id: string) => {
        revoked.push(id);
        return Promise.resolve();
      },
    } as unknown as OAuthHelpers;
    expect(await revokeUserGrants(oauth, "1001")).toBe(3);
    expect(revoked).toStrictEqual(["g1", "g2", "g3"]);
  });
});

describe("withAccessToken", () => {
  const deps = (reason: "unavailable" | "reconnect") =>
    toolDeps({ getAccessToken: () => Promise.resolve({ ok: false as const, reason }) });

  it("keeps the grants and says to retry when Etsy is unavailable", async () => {
    const d = deps("unavailable");
    const result = await withAccessToken(d, () => Promise.reject(new Error("not reached")));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Try again");
    expect(d.revoked).toBe(0);
  });

  it("turns an unexpected error into a fixed message that quotes nothing", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const d = { ...deps("reconnect"), getAccessToken: () => Promise.reject(new Error("secret-ish detail")) };
    const result = await withAccessToken(d, () => Promise.reject(new Error("not reached")));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain("secret-ish");
    expect(spy).toHaveBeenCalledWith('{"event":"tool_failed","reason":"unexpected_error"}');
  });

  it("revokes the grants when the connection is gone for good", async () => {
    const d = deps("reconnect");
    await withAccessToken(d, () => Promise.reject(new Error("not reached")));
    expect(d.revoked).toBe(1);
  });
});

describe("logEvent", () => {
  it("writes only allowlisted fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logEvent("thing_happened", { status: 502, reason: "x", access_token: "secret", email: "a@b.c" });
    logEvent("bare");
    expect(spy.mock.calls.map((args): unknown => args[0])).toStrictEqual([
      '{"event":"thing_happened","status":502,"reason":"x"}',
      '{"event":"bare"}',
    ]);
  });
});

describe("pages", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("serves pages uncached, unframeable, with no scripts allowed", () => {
    const page = htmlPage(200, "t", "<p>b</p>");
    expect(page.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
