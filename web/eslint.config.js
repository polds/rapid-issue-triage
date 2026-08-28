import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // Build output and generated files are never linted.
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "*.tsbuildinfo"] },

  // Browser sources: type-aware rules plus the React hook contracts.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],

      // Unused code is an error, but a `_` prefix is the explicit
      // "intentionally ignored" marker (rest destructuring, unused args).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Security: the escape hatches that would let Linear-authored issue
      // text reach an evaluator. None are used today; keep it that way.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",

      // `onClick={async () => …}` is idiomatic React and safe here: every
      // handler already try/catches into a toast. Void-return checking stays
      // on everywhere except JSX attributes.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],

      // Components declared inside another component are a new identity on
      // every render, so React unmounts and remounts their subtree (losing
      // DOM and local state). No call sites do this today; keep it that way.
      "react-hooks/static-components": "error",

      // Fire-and-forget is allowed, but it has to be spelled out: `void` for
      // calls whose failure is already handled inside the callee, or a real
      // `.catch()` where the user needs to see it.
      "@typescript-eslint/no-floating-promises": "error",

      // ---------------------------------------------------------------
      // Deferred, not forgotten. Each of these is legitimate but needs a
      // codebase-wide cleanup that does not belong in a CI change. They are
      // listed explicitly so the debt is visible in review rather than
      // silently missing from the config.
      // ---------------------------------------------------------------

      // ~60 hits, nearly all downstream of `res.json()` being `any` in
      // api.ts. Fixing this means typing the fetch wrapper against `unknown`
      // and narrowing at each call site.
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",

      // The remaining React Compiler rules new in eslint-plugin-react-hooks
      // v7. They flag real immutability and purity issues, but adopting them
      // is a rendering change, not a lint fix.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },

  // Tests: Node globals, and fixtures that are deliberately hostile input.
  {
    files: ["src/**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // `javascript:alert(1)` is the input under test, not a call site.
      "no-script-url": "off",
      "react-refresh/only-export-components": "off",
    },
  },

  // Node-side config files run outside the browser and outside tsconfig.
  {
    files: ["*.config.{js,ts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
