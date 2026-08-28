import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import sonarjs from "eslint-plugin-sonarjs";

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
      // Code quality, in the shape .golangci.yml gives the backend: take the
      // whole rule set, then opt out of the ones that fight a convention this
      // project already decided. Without it the frontend has no counterpart
      // to gocyclo, dupl or the bug-pattern half of golangci-lint.
      sonarjs.configs.recommended,
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

      // setState in an effect body costs a second render pass, and usually
      // means the value should be derived during render or updated by the
      // event that causes it. Effects are for syncing with the outside world.
      "react-hooks/set-state-in-effect": "error",

      // React Compiler purity: render must be deterministic. `Math.random()`,
      // `Date.now()` and friends belong in an effect, a lazy `useState`
      // initialiser, or an event handler — not in a render body.
      "react-hooks/purity": "error",

      // Fire-and-forget is allowed, but it has to be spelled out: `void` for
      // calls whose failure is already handled inside the callee, or a real
      // `.catch()` where the user needs to see it.
      "@typescript-eslint/no-floating-promises": "error",

      // React Compiler immutability: reassigning a captured binding after
      // render, or mutating a value a hook already captured, is a
      // correctness bug rather than a style preference.
      "react-hooks/immutability": "error",

      // Type safety. `req()` in api.ts decodes into `unknown` and asserts the
      // response shape in exactly one place, so no `any` escapes the fetch
      // wrapper into its callers. Keep it that way.
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-explicit-any": "error",

      // --- sonarjs opt-outs. Each one is a decision, not noise triage. ---

      // The `void` prefix is this project's spelling of fire-and-forget (see
      // no-floating-promises above). sonarjs wants it gone; we require it.
      "sonarjs/void-use": "off",

      // Props are already `readonly` by contract -- React never writes to
      // them and nothing here mutates one. Annotating 30-odd interfaces buys
      // no enforcement the type checker isn't giving.
      "sonarjs/prefer-read-only-props": "off",

      // Math.random() here drives confetti and card jitter. No secret, token
      // or id is generated in the browser; every one comes from the server.
      "sonarjs/pseudo-random": "off",

      // Style calls that go the other way from the existing tree: nested
      // ternaries for variant lookup, helper closures inside components, and
      // `.match()` where the result is destructured.
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-functions": "off",
      "sonarjs/prefer-regexp-exec": "off",
      "sonarjs/function-return-type": "off",

      // The frontend counterpart to gocyclo's 15. Cognitive complexity counts
      // nesting harder than cyclomatic does, so the same number would be a
      // much tighter cap; 25 is where today's largest reducer sits. Split the
      // function rather than raising this, exactly as on the Go side.
      "sonarjs/cognitive-complexity": ["error", 25],
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

      // Test bodies repeat by design: the same string in three cases is three
      // independent assertions, and two cases that read alike are the point.
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/no-identical-functions": "off",
    },
  },

  // Node-side scripts and config files run outside the browser and outside
  // tsconfig. `scripts/` is tooling the Makefile calls, not shipped code.
  {
    files: ["*.config.{js,ts}", "scripts/**/*.mjs"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
