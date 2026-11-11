import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects, one `npm test`:
// - `workers` runs every test of src/ inside the real workerd runtime and is the
//   only project coverage is collected from.
// - `node` runs repo-level checks (lint gate, CI structure, gate integrity) that
//   need Node APIs such as the filesystem and ESLint itself.
export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
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
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
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
