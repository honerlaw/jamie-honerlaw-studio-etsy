import agentic from "@onerlaw/agentic-eslint-plugin";
import { ESLint } from "eslint";
import path from "node:path";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "lint-fixtures");

/** Lints fixtures with the repo's real config, fixture ignores lifted and fixture type info supplied. */
function repoLinter(): ESLint {
  return new ESLint({
    cwd: ROOT,
    overrideConfigFile: path.join(ROOT, "eslint.config.ts"),
    ignore: false,
    overrideConfig: {
      files: ["tests/lint-fixtures/**/*.ts"],
      languageOptions: {
        parserOptions: {
          project: [path.join(FIXTURES, "tsconfig.json")],
          tsconfigRootDir: ROOT,
        },
      },
    },
  });
}

async function ruleIdsFor(file: string): Promise<string[]> {
  const [result] = await repoLinter().lintFiles([path.join(FIXTURES, file)]);
  if (result === undefined) {
    throw new Error(`ESLint returned no result for ${file}`);
  }
  return result.messages.map((message) => message.ruleId ?? `fatal: ${message.message}`);
}

describe("lint gate", () => {
  it("reports every guarded violation in bad.ts", async () => {
    const ruleIds = await ruleIdsFor("bad.ts");
    expect(ruleIds).toEqual(
      expect.arrayContaining([
        "@typescript-eslint/no-explicit-any",
        "@typescript-eslint/no-floating-promises",
        "@eslint-community/eslint-comments/require-description",
        "agentic/no-credential-in-url",
      ]),
    );
  });

  it("detects import cycles, which needs the TypeScript resolver to be wired", async () => {
    expect(await ruleIdsFor("cycle-a.ts")).toContain("import-x/no-cycle");
  });

  it("applies the core rules to plain-JS repo scripts", async () => {
    expect(await ruleIdsFor("loose-script.mjs")).toContain("eqeqeq");
  });

  it("reports nothing for good.ts", async () => {
    expect(await ruleIdsFor("good.ts")).toStrictEqual([]);
  });

  it("pins how agentic/one-export-per-file treats re-exports", async () => {
    // Only the rule under test, so the result reflects that rule's behaviour alone.
    const linter = new ESLint({
      cwd: ROOT,
      overrideConfigFile: true,
      ignore: false,
      overrideConfig: [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tseslint.parser },
          plugins: { agentic },
          rules: { "agentic/one-export-per-file": "error" },
        },
      ],
    });
    const [result] = await linter.lintFiles([path.join(FIXTURES, "reexports.ts")]);
    // Re-exports are not function definitions in this file, so the rule allows
    // them. src/index.ts re-exporting Durable Object classes is therefore legal
    // without a carve-out for this rule.
    expect(result?.messages.map((message) => message.ruleId)).toStrictEqual([]);
  });
});
