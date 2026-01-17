import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "examples/**", "pkg/**"] },
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
      // Disable for now - library wraps generated types
      "@typescript-eslint/no-explicit-any": "off",
      // Allow aliasing this for callback patterns
      "@typescript-eslint/no-this-alias": "off",
      // Allow let for intentional reassignment patterns
      "prefer-const": "off",
    },
  }
);
