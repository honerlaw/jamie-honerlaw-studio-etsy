import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// With 0 required approvals, the gates are the only review an agent PR gets.
// This test pins them, so loosening a gate means visibly editing this file in
// the same PR. Never relax an expectation here to make another change pass.

const ROOT = path.resolve(import.meta.dirname, "..");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
}

function readText(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

const REQUIRED_TSCONFIG_FLAGS = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noPropertyAccessFromIndexSignature",
  "noUnusedLocals",
  "noUnusedParameters",
  "useUnknownInCatchVariables",
  "verbatimModuleSyntax",
  "isolatedModules",
  "forceConsistentCasingInFileNames",
] as const;

const REQUIRED_ERROR_RULES = [
  "@typescript-eslint/no-explicit-any",
  "@typescript-eslint/explicit-module-boundary-types",
  "@typescript-eslint/switch-exhaustiveness-check",
  "@typescript-eslint/strict-boolean-expressions",
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/consistent-type-imports",
  "@typescript-eslint/no-non-null-assertion",
  "@typescript-eslint/prefer-readonly",
  "eqeqeq",
  "no-param-reassign",
  "no-restricted-syntax",
  "max-lines",
  "no-console",
  "@eslint-community/eslint-comments/require-description",
  "@eslint-community/eslint-comments/no-unlimited-disable",
  "@eslint-community/eslint-comments/no-unused-disable",
  "@eslint-community/eslint-comments/disable-enable-pair",
  "import-x/no-cycle",
  "import-x/no-extraneous-dependencies",
  "import-x/no-default-export",
  "agentic/no-credential-in-url",
  "agentic/one-export-per-file",
] as const;

interface CompilerOptions {
  readonly compilerOptions: Record<string, unknown>;
}

interface CoverageThresholds {
  readonly lines: number;
  readonly branches: number;
}

describe("gate integrity", () => {
  it("keeps every strict tsconfig flag on", () => {
    // tsconfig.json is plain JSON here (no comments), so JSON.parse is exact.
    const { compilerOptions } = readJson("tsconfig.json") as CompilerOptions;
    for (const flag of REQUIRED_TSCONFIG_FLAGS) {
      expect(compilerOptions[flag], `tsconfig flag ${flag}`).toBe(true);
    }
    expect(compilerOptions["allowJs"]).toBe(false);
  });

  it("lints with zero warnings allowed", () => {
    const { scripts } = readJson("package.json") as { readonly scripts: Record<string, string> };
    expect(scripts["lint"]).toContain("--max-warnings 0");
  });

  it("keeps the coverage thresholds and the per-file floor", async () => {
    const { default: config } = (await import(path.join(ROOT, "vitest.config.ts"))) as {
      readonly default: { readonly test: { readonly coverage: { readonly thresholds: CoverageThresholds } } };
    };
    const { thresholds } = config.test.coverage;
    expect(thresholds.lines).toBeGreaterThanOrEqual(90);
    expect(thresholds.branches).toBeGreaterThanOrEqual(90);
    expect(readText("scripts/check-coverage-floor.mjs")).toMatch(/const FLOOR = (8\d|9\d|100);/u);
    const { scripts } = readJson("package.json") as { readonly scripts: Record<string, string> };
    expect(scripts["test"]).toContain("node scripts/check-coverage-floor.mjs");
  });

  it("keeps ci-pass depending on every gate job", () => {
    const { jobs } = parse(readText(".github/workflows/ci.yml")) as {
      readonly jobs: Record<string, { readonly needs?: readonly string[] }>;
    };
    expect([...(jobs["ci-pass"]?.needs ?? [])].sort()).toStrictEqual(
      ["build", "format", "generated-types-match", "knip", "lint", "secret-scan", "test", "typecheck"].sort(),
    );
  });

  it("keeps the main ruleset strict with no bypass", () => {
    const ruleset = readJson(".github/rulesets/main.json") as {
      readonly enforcement: string;
      readonly bypass_actors: readonly unknown[];
      readonly rules: readonly { readonly type: string; readonly parameters?: Record<string, unknown> }[];
    };
    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.bypass_actors).toStrictEqual([]);
    const types = ruleset.rules.map((rule) => rule.type);
    expect(types).toEqual(
      expect.arrayContaining(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]),
    );
    const checks = ruleset.rules.find((rule) => rule.type === "required_status_checks")?.parameters;
    expect(checks?.["required_status_checks"]).toStrictEqual([{ context: "ci-pass" }]);
  });

  it("keeps every named lint rule at error for source files", async () => {
    const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.ts") });
    const config = (await eslint.calculateConfigForFile(path.join(ROOT, "src", "routes", "health.ts"))) as {
      readonly rules: Record<string, unknown>;
    };
    for (const rule of REQUIRED_ERROR_RULES) {
      const setting = config.rules[rule];
      const severity = Array.isArray(setting) ? (setting as readonly unknown[])[0] : setting;
      expect(severity, `rule ${rule}`).toBe(2);
    }
  });
});
