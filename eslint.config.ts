import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import js from "@eslint/js";
import agentic from "@onerlaw/agentic-eslint-plugin";
import type { Linter } from "eslint";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

// The gates are the only review an agent-authored PR gets (the `main` ruleset
// requires 0 approvals), so this config is deliberately unforgiving. Never
// downgrade a rule here to make a PR pass; `tests/gate-integrity.test.ts`
// pins the rules the proposal names, so loosening one is a visible test edit.

const TS_FILES = ["**/*.ts"];
// Every file ESLint lints: TypeScript plus the plain-JS repo scripts.
const CODE_FILES = ["**/*.{ts,mjs}"];

// Generated code, vendored research and the lint-gate fixtures are excluded
// from the main run. The fixtures are linted on purpose by tests/lint-gate.test.ts.
const IGNORES = [
  "node_modules/**",
  "dist/**",
  "coverage/**",
  ".wrangler/**",
  "src/etsy/generated/**",
  "worker-configuration.d.ts",
  "docs/research/**",
  "tests/lint-fixtures/**",
];

const agenticPlugin = agentic as unknown as NonNullable<Linter.Config["plugins"]>[string];

const config: Linter.Config[] = [
  { ignores: IGNORES },

  // Baseline correctness for every linted file, TypeScript and scripts alike.
  { files: CODE_FILES, ...js.configs.recommended },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: {
        // Worker code (src/, test/) and Node-side code (tests/, configs) are
        // type-checked under different lib/types settings, hence two projects.
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves identifiers itself; espree's no-undef misreports types.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/only-throw-error": "error",
    },
  },
  {
    // Core rules for every linted file, scripts included.
    files: CODE_FILES,
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      eqeqeq: ["error", "always"],
      "no-param-reassign": ["error", { props: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a union of string literals or an `as const` object instead of an enum.",
        },
        { selector: "TSModuleDeclaration[kind='namespace']", message: "Use ES modules instead of namespaces." },
      ],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "no-console": "error",
    },
  },

  // Every suppression must say why, and none may be blanket or stale.
  comments.recommended,
  {
    rules: {
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": "error",
    },
  },

  // Imports: no cycles, no undeclared dependencies, no default exports.
  // The TypeScript resolver is load-bearing: without it extensionless imports
  // never resolve and no-cycle silently checks nothing (pinned by lint-gate).
  {
    files: CODE_FILES,
    plugins: { "import-x": importX },
    settings: {
      // Extensions and parsers (as in import-x's TypeScript preset): without
      // them import-x cannot parse the modules it resolves, and no-cycle sees no edges.
      "import-x/extensions": [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".mts", ".cts"] },
      "import-x/external-module-folders": ["node_modules", "node_modules/@types"],
      "import-x/core-modules": ["cloudflare:workers", "cloudflare:test"],
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: ["./tsconfig.json", "./tsconfig.node.json"],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      "import-x/no-cycle": "error",
      "import-x/no-unresolved": "error",
      "import-x/no-extraneous-dependencies": "error",
      "import-x/no-default-export": "error",
    },
  },

  // Selected unicorn correctness rules (not its stylistic opinions).
  {
    files: CODE_FILES,
    plugins: { unicorn },
    rules: {
      "unicorn/no-for-each": "error",
      "unicorn/no-useless-promise-resolve-reject": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/no-thenable": "error",
      "unicorn/no-instanceof-builtins": "error",
      "unicorn/error-message": "error",
      "unicorn/prefer-type-error": "error",
    },
  },

  // @onerlaw/agentic-eslint-plugin: one block per rule, each matching the files
  // that rule must cover (the plugin ships no preset on purpose).
  {
    files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
    plugins: { agentic: agenticPlugin },
    rules: { "agentic/no-credential-in-url": "error" },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { agentic: agenticPlugin },
    rules: { "agentic/one-export-per-file": "error" },
  },

  // Named carve-outs. Each exists because a platform contract requires it.
  {
    // The Workers runtime loads the module's default export as the handler.
    files: ["src/index.ts"],
    rules: { "import-x/no-default-export": "off" },
  },
  {
    // Tool configs are loaded by their CLIs through a default export.
    files: ["eslint.config.ts", "vitest.config.ts"],
    rules: { "import-x/no-default-export": "off" },
  },
  {
    // Node-side repo scripts print their results; they never run in the Worker.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
    rules: { "no-console": "off" },
  },
  {
    // Plain JS scripts have no type information for the type-aware rule set.
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
];

export default config;
