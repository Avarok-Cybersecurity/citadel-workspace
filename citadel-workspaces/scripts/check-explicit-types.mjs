/**
 * Every declaration carries a type, and the count can only go down.
 *
 * The policy: a TypeScript file in this repository is strongly typed —
 * `const storedSession: StoredSession = await …`, not `const storedSession =
 * await …`. Inference is convenient and it is also how a return type changes
 * shape three modules away and nothing says so; round 239 was exactly that, a
 * value read from one place and believed everywhere.
 *
 * ## It was a ratchet, and the ratchet is spent
 *
 * Turning the rules on outright once failed 951 of 1087 files with 7,823
 * findings. A gate nobody can pass is a gate that gets switched off, so this
 * held a per-file baseline that could only shrink: 7,823 → 251 → 0.
 *
 * It is zero now, so the baseline and its `--write` lever are gone. There is
 * nothing left to record and no way to record more. Every declaration in
 * `src/` states its type, and a new one that does not fails here.
 *
 * ## What is required
 *
 * | rule | what it asks for |
 * |---|---|
 * | `typedef` (variableDeclaration, parameter, member/property) | `const x: T = …` |
 * | `explicit-function-return-type` | `function f(): T` |
 * | `explicit-module-boundary-types` | exported functions state what they return |
 * | `no-explicit-any` | already enforced outright in eslint.config.js |
 *
 * `arrowParameter` is deliberately NOT required: a callback passed to `.map()`
 * or to an event handler is contextually typed already, and annotating it
 * restates what the signature it is passed to has just said. Requiring it adds
 * 1,999 findings that make code longer without making it safer. `parameter` IS
 * required, so every named function's inputs are declared.
 *
 * `variableDeclarationIgnoreFunction` is on: `const f = (a: string): number =>
 * …` states its types in the signature, and demanding a second annotation on
 * the binding is noise.
 *
 * A declaration ending in `as const` (or `as const satisfies T`, which only adds a check) is
 * exempt for the same reason, and a stronger one: a const-assertion gives the binding the narrowest type the
 * value admits. There is no annotation that improves on it — every one is
 * either identical or wider, and writing it out duplicates the literal keys
 * and values, which is the SSOT violation the annotation was meant to prevent.
 * The gate exists because inference can drift when a value's shape changes
 * three modules away; here the value IS the type, so it cannot.
 *
 * A `cva(...)` declaration is exempt for the same reason, established by
 * trying both annotations that could work and watching each fail:
 *
 *   - `const alertVariants: (props?: VariantProps<typeof alertVariants> & …)`
 *     is TS2502, "referenced directly or indirectly in its own type
 *     annotation". The component's props are derived from the variants, so
 *     naming the type needs the type.
 *   - `const badgeVariants: ReturnType<typeof cva>` compiles, and erases the
 *     variant union: `VariantProps` of it is `{}`, and three call sites lose
 *     `variant` as a prop. It type-checks the declaration by breaking its
 *     consumers.
 *
 * The only remaining form spells the variant keys out by hand, at which point
 * `VariantProps<typeof x>` reads the annotation rather than the config and a
 * config change stops matching in silence — the exact drift this gate exists
 * to catch, pointed the other way.
 *
 * Two test-double forms are exempt on the same grounds, and only these two:
 *
 *   - `vi.fn<Sig>(…)` — the signature is stated, in the type argument.
 *   - `vi.spyOn(obj, 'method')` — the type is derived from the real method.
 *     Annotating it DECOUPLES the double from what it doubles: the mock keeps
 *     compiling after the real signature changes, which is the drift this gate
 *     exists to catch.
 *
 * A bare `vi.fn()` is NOT exempt. It carries no signature at all, so an
 * annotation is the only thing that can say what the double stands for — the
 * case where it is worth the most.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RULES = {
  '@typescript-eslint/typedef': ['error', {
    variableDeclaration: true,
    memberVariableDeclaration: true,
    propertyDeclaration: true,
    parameter: true,
    arrowParameter: false,
    variableDeclarationIgnoreFunction: true,
  }],
  '@typescript-eslint/explicit-function-return-type': ['error', {
    allowExpressions: false,
    allowTypedFunctionExpressions: true,
    allowHigherOrderFunctions: true,
  }],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
};

const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: { rules: RULES },
});

/**
 * Whether the declaration reported at `line` ends in a const-assertion.
 *
 * Walks forward from the declaration balancing brackets and looks at the line
 * that closes it. Covers both the one-liner (`const A = 1 as const;`) and the
 * object/array literal spanning many lines.
 */
function isConstAssertion(lines, line) {
  let depth = 0;
  for (let i = line - 1; i < Math.min(lines.length, line + 500); i += 1) {
    for (const character of lines[i]) {
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) depth -= 1;
    }
    if (depth <= 0) return /\bas const(?:\s+satisfies\s+.+?)?\s*;?\s*$/.test(lines[i].replace(/\/\/.*$/, '').trim());
  }
  return false;
}

const results = await eslint.lintFiles(['src/**/*.ts', 'src/**/*.tsx']);

if (results.length < 100) {
  console.error(`\n  Linted only ${results.length} file(s) — the glob or the config moved.\n`);
  process.exit(1);
}

/** `{ 'src/x.ts': 3 }` — files with no findings are absent. */
const counts = {};
for (const result of results) {
  const source = readFileSync(result.filePath, 'utf-8').split('\n');
  const findings = result.messages.filter((message) => {
    if (!(message.ruleId in RULES)) return false;
    if (message.ruleId !== '@typescript-eslint/typedef') return true;
    const declaration = source[message.line - 1] ?? '';
    if (/=\s*cva\(/.test(declaration)) return false;
    if (/\bvi\.fn</.test(declaration) || /\bvi\.spyOn\(/.test(declaration)) return false;
    return !isConstAssertion(source, message.line);
  }).length;
  if (findings > 0) counts[relative(APP, result.filePath)] = findings;
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (total > 0) {
  console.error('\n  Declarations without a type:\n');
  for (const [file, found] of Object.entries(counts)) {
    console.error(`::error file=citadel-workspaces/${file}::${found} declaration(s) without a type`);
  }
  console.error(
    '\n  Annotate them. Every declaration states its type here — see the header of' +
    '\n  scripts/check-explicit-types.mjs for what is required, what is exempt, and why.\n',
  );
  process.exit(1);
}

console.log(`  Explicit types: ${results.length} file(s), every declaration typed  ok`);
