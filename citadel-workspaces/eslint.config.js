import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: [
    "dist/**",
    "node_modules/**",
    "public/**",
    "ui/public/**",  // WASM generated files
    "vendor/cdoc/**",  // cdoc-wasm glue, vendored by scripts/sync-cdoc-wasm.sh and pinned by PROVENANCE.json
    "*.config.js",
    "*.config.ts",
    "integration-tests/**",  // Has its own ESLint config
  ] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ["./tsconfig.app.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Off, deliberately, and the reason is a genuine conflict rather than a
      // preference.
      //
      // This project requires every declaration to state its type. For a
      // constant holding a string literal, the annotation typedef asks for is
      // `const MODE: 'compact' = 'compact'`, and prefer-as-const calls exactly
      // that shape an error and wants the annotation removed in favour of `as
      // const`. Both cannot be satisfied: `as const` is not an annotation, so
      // typedef still objects.
      //
      // Two hundred and ten declarations sit in that gap. The explicit-type
      // policy is the one with a pipeline check and a stated goal behind it, so
      // it is the one that wins; the redundancy prefer-as-const exists to
      // prevent is redundancy this codebase has chosen on purpose.
      '@typescript-eslint/prefer-as-const': 'off',
      // Accessibility. Previously unenforced, which is why aria-* appeared in
      // only 10 of ~207 component files and several <img> shipped with no alt.
      ...jsxA11y.configs.recommended.rules,
      // AFTER the recommended spread above, not before: placed first, the
      // spread put the default back and the override did nothing.
      //
      // A scrollable region is legitimately focusable, and axe requires it:
      // `scrollable-region-focusable` is a serious violation without it. The
      // rule's default role list omits `region`, so the two tools disagreed and
      // the accessible fix was the lint error. axe is the one holding the WCAG
      // criterion, so the list is widened rather than the fix reverted.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["region", "tabpanel"] }],
      "react-hooks/exhaustive-deps": "error",
      // Disabled: HMR optimization warning, not code quality issue
      // Many UI components legitimately export variants alongside components
      "react-refresh/only-export-components": "off",
      // Re-enabled. With this off, dead variables, unused imports and orphaned
      // parameters accumulate invisibly — which is how several unreferenced modules
      // survived in this tree. Unused *imports* are delegated to unused-imports,
      // which (unlike the base rule) can auto-fix them, so `eslint --fix` keeps the
      // bundle free of dead imports. `_`-prefixed names stay exempt for the
      // genuinely-unused-by-design cases: unused catch bindings, and positional
      // parameters that exist only to satisfy a shared prop type.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": ["error", {
        args: "after-used",
        argsIgnorePattern: "^_",
        vars: "all",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      // Prevent accidentally not awaiting a Promise
      // Use "void someAsyncFunction();" to explicitly run in background
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { "checksConditionals": true, "checksVoidReturn": false, "checksSpreads": false }],
      // ON. There were nine `any`s in this codebase and they are gone: the
      // event emitter erases its payload type in one named place with one cast
      // at each boundary, and the four `Record<string, any>` metadata bags
      // became `Record<string, unknown>` so their readers have to narrow. The
      // one consumer that was calling `data.onCardClick()` on faith now checks
      // it is a function first -- under `any` that call would happily have run
      // a string.
      "@typescript-eslint/no-explicit-any": "error",
      // Disable non-critical rules to unblock CI - TODO: fix these later
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      // Keep the design system from eroding again. The app previously carried 647
      // hardcoded hex colours across 130 files — five competing "background"
      // values among them — while the tokens in index.css went unused, which is
      // why a theme switch was impossible. Use bg-card / text-muted-foreground /
      // border-border instead; add a token if none of them fit.
      "no-restricted-syntax": ["error", {
        selector: "JSXAttribute[name.name='className'] Literal[value=/\\[#[0-9A-Fa-f]{6}\\]/]",
        message: "Hardcoded hex colour in className. Use a design token (bg-card, text-muted-foreground, border-border, bg-surface, text-primary-accent) — see src/index.css.",
      }, {
        selector: "JSXAttribute[name.name='className'] TemplateElement[value.raw=/\\[#[0-9A-Fa-f]{6}\\]/]",
        message: "Hardcoded hex colour in className. Use a design token — see src/index.css.",
      }, {
        // Raw Tailwind palette classes (bg-purple-500, text-green-400, …) sit
        // outside the token system, so workspace themes can never restyle them.
        // Checked on every string, not just className: several colour maps live
        // in plain .ts objects (role badges, file-state icons) and those were
        // exactly where hardcoded hues kept accumulating.
        //
        // white and black have no numeric suffix, so the original `-[0-9]`
        // anchor walked straight past them — fourteen sites accumulated in
        // components/p2p alone, including `bg-surface text-white`, which made a
        // failed message unreadable for every light-mode user.
        selector: "Literal[value=/(^|[^\\w-])(bg|text|border(-[lrtbxy])?|ring|from|to|via|shadow|fill|stroke|outline|divide|accent|decoration)-(?:purple|green|red|blue|amber|yellow|orange|pink|indigo|teal|cyan|violet|fuchsia|rose|lime|emerald|sky|gray|slate|zinc|neutral|stone)-[0-9]/]",
        message: "Hardcoded Tailwind colour. Use a semantic token instead: primary/primary-accent (brand), success, destructive, warning, muted/muted-foreground, surface, border, foreground — see src/index.css. white and black are included because they do not invert: `bg-surface text-white` put white on a 96%-lightness surface in light mode, about 1.08:1, and every `hover:bg-white/10` tint vanished there.",
      }, {
        selector: "TemplateElement[value.raw=/(^|[^\\w-])(bg|text|border(-[lrtbxy])?|ring|from|to|via|shadow|fill|stroke|outline|divide|accent|decoration)-(?:purple|green|red|blue|amber|yellow|orange|pink|indigo|teal|cyan|violet|fuchsia|rose|lime|emerald|sky|gray|slate|zinc|neutral|stone)-[0-9]/]",
        message: "Hardcoded Tailwind colour. Use a semantic token instead: primary/primary-accent (brand), success, destructive, warning, muted/muted-foreground, surface, border, foreground — see src/index.css. white and black are included because they do not invert: `bg-surface text-white` put white on a 96%-lightness surface in light mode, about 1.08:1, and every `hover:bg-white/10` tint vanished there.",
      }, {
        // text-white / text-black / bg-white specifically. These are NOT a
        // stylistic preference — they do not invert, so they break outright in
        // whichever theme they were not written for. `bg-surface text-white`
        // shipped white on a 96%-lightness surface in light mode, about 1.08:1,
        // which made a failed message unreadable; every `hover:bg-white/10` tint
        // simply vanished there. Fourteen sites in components/p2p alone.
        //
        // bg-black/N is deliberately NOT listed: a modal scrim should be black
        // in both themes, which is why the broad palette rule was the wrong
        // place to express this. Nor are border-white / ring-white, which the
        // colour picker needs against arbitrary user-chosen hues.
        selector: "Literal[value=/(^|[^\\w-])(text-white|text-black|bg-white)(\\/|\\s|$)/]",
        message: "text-white, text-black and bg-white do not invert with the theme. Use text-foreground, text-primary-foreground, bg-background/bg-surface, or a foreground-relative tint like bg-foreground/10.",
      }, {
        selector: "TemplateElement[value.raw=/(^|[^\\w-])(text-white|text-black|bg-white)(\\/|\\s|$)/]",
        message: "text-white, text-black and bg-white do not invert with the theme. Use text-foreground, text-primary-foreground, bg-background/bg-surface, or a foreground-relative tint like bg-foreground/10.",
      }],
      "no-case-declarations": "off",
      "no-useless-escape": "off",
      // Keep rules-of-hooks as error but will fix the violations
    },
  }
);
