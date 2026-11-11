import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Test-only secrets. The key is 32 zero bytes: fine for tests, never for a deployment.
const TEST_BINDINGS = {
  ETSY_KEYSTRING: "test-keystring",
  ETSY_SHARED_SECRET: "test-shared-secret",
  ALLOWED_ETSY_USER_ID: "1001",
  ALLOWED_ETSY_SHOP_ID: "2002",
  TOKEN_ENC_KEYS: JSON.stringify({ k1: "A".repeat(43) + "=" }),
  TOKEN_ENC_KID: "k1",
  UPLOAD_SIGNING_KEY: "test-only-".repeat(4),
  MCP_CLIENTS: JSON.stringify([
    {
      id: "claude",
      name: "Claude",
      secret: "test-only-".repeat(4),
      redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      secret: "test-only-".repeat(5),
      redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    },
  ]),
};

// Two projects, one `npm test`:
// - `workers` runs every test of src/ inside the real workerd runtime.
// - `node` runs repo-level checks (lint gate, CI structure, gate integrity) that
//   need Node APIs such as the filesystem and ESLint itself, and the tests of the
//   TypeScript deploy and bootstrap scripts in scripts/.
// Coverage covers src/ and scripts/**/*.ts under the same floors.
export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts", "scripts/**/*.ts"],
      exclude: ["src/etsy/generated/**"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 90,
        branches: 90,
        perFile: false,
      },
    },
    projects: [
      {
        plugins: [
          cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: TEST_BINDINGS } }),
        ],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/support/setup.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
