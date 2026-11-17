import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // The playwright configs are excluded from tsconfig.json's include list,
  // so project-aware parsing can't process them. Ignore them here so we
  // don't have to add a duplicate tsconfig just to satisfy the linter.
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright.config.ts",
      "playwright.tools.config.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      // Prevent accidentally not awaiting a Promise
      "@typescript-eslint/no-floating-promises": "error",
      // Tests may use any for mocking
      "@typescript-eslint/no-explicit-any": "off",
      // Tests may use @ts-ignore for intentional type bypasses
      "@typescript-eslint/ban-ts-comment": "off",
      // Tests may have complex finally blocks
      "no-unsafe-finally": "off",
      // Playwright's fixture API requires `async ({}, use) => ...` for
      // fixtures that don't depend on any other fixture. The rule can't
      // distinguish this idiom from a genuine empty-pattern bug, so
      // disable it here rather than scattering disable comments across
      // every fixture file.
      "no-empty-pattern": "off",

      "no-restricted-syntax": ["error", {
        // Mixing Playwright's text= engine with anything else in a comma list
        // does not produce a union. `'text="A", text="B"'` parses as ONE text
        // selector for the literal `A", text="B` and matches nothing, silently;
        // `'#id, text="X"'` throws a CSS parse error that the usual
        // `.catch(() => false)` turns into a quiet false. Eight of these were in
        // the suite, every one a dead assertion.
        selector: 'Literal[value=/text=\"[^\"]*\",/]',
        message: 'This selector cannot match. A comma list mixing text= with another engine is not a union: `text="A", text="B"` matches the literal string `A", text="B`, and `#id, text="X"` throws. Use page.getByText(/A|B/) for any-of-these, or locatorA.or(locatorB) for a real union.',
      }, {
        // The same defect with text= LAST, so there is no comma after it:
        // `'button:has-text("Admin"), [data-testid*="admin"], text="Admin Settings"'`.
        // That form throws rather than matching, and the throw is swallowed by
        // the `.catch(() => false)` these call sites all have. The rule above
        // only sees text= followed by a comma, so it missed this one.
        selector: 'Literal[value=/,\\s*text=\\"/]',
        message: 'This selector cannot match. Mixing text= into a CSS comma list throws a CSS parse error, which .catch(() => false) then hides. Use locatorA.or(locatorB) for a union, or page.getByText() on its own.',
      }],
    },
  }
);
