import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "examples/**", "pkg/**", "src/types/generated/**", "src/types/InternalServiceRequest.ts"] },
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
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Prevent accidentally not awaiting a Promise
      "@typescript-eslint/no-floating-promises": "error",
      // Track progress toward elimination of any
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow aliasing this for callback patterns
      "@typescript-eslint/no-this-alias": "off",
      // Allow let for intentional reassignment patterns
      "prefer-const": "off",
    },
  }
);
