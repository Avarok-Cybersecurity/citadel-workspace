/**
 * Give a React component arrow its `JSX.Element` return type.
 *
 * These are the shape the AST walker keeps missing:
 *
 *   const AlertDialogHeader = ({
 *     className,
 *     ...props
 *   }: React.HTMLAttributes<HTMLDivElement>) => (
 *
 * -- an arrow whose parameter list spans several lines, whose body is a
 * parenthesised JSX expression, and whose return type the compiler prints as
 * `import("/…/@types/react/jsx-runtime").JSX.Element`. Forty-odd of them, and
 * the general tool reached none.
 *
 * A component returns `JSX.Element`, or `JSX.Element | null` when it can bail
 * out early. Both spellings are tried and the compiler decides, which is also
 * what stops this from guessing: a function that is not a component fails to
 * compile and is put back.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RETURN_RULE = '@typescript-eslint/explicit-function-return-type';
const BOUNDARY_RULE = '@typescript-eslint/explicit-module-boundary-types';

const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: {
    rules: {
      [RETURN_RULE]: ['error', { allowExpressions: false, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true }],
      [BOUNDARY_RULE]: 'error',
    },
  },
});

// `.ts` as well as `.tsx`. A hook or a factory has the same multi-line
// parameter list and the same missing return type; restricting this to .tsx
// left `) => {` in useJoinRegistration and MDXEditor untouched for no reason
// other than the file extension.
const results = await eslint.lintFiles(['src/**/*.tsx', 'src/**/*.ts']);
/** file -> the lines that end a parameter list and want a return type */
const wanted = new Map();
for (const result of results) {
  const lines = readFileSync(result.filePath, 'utf-8').split('\n');
  const hits = result.messages
    .filter((m) => m.ruleId === RETURN_RULE || m.ruleId === BOUNDARY_RULE)
    .map((m) => m.line)
    .filter((line) => /\)\s*=>\s*[({]?\s*$/.test(lines[line - 1] ?? ''));
  if (hits.length > 0) wanted.set(result.filePath, [...new Set(hits)].sort((a, b) => b - a));
}

function typechecks() {
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], { cwd: APP, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

let written = 0;
for (const [file, hits] of wanted) {
  const before = readFileSync(file, 'utf-8');
  // One line at a time, not the whole file at once: a file with four of these
  // where one is not a component had all four reverted together, and the run
  // reported "0 across 4 files" while three of them were perfectly fine.
  for (const line of hits) {
    // A `.ts` file has no JSX, so `void` and `Promise<void>` are the useful
    // spellings there; a `.tsx` one is usually a component. Both lists are
    // tried and the compiler decides which fits.
    const spellings = file.endsWith('.tsx')
      ? ['JSX.Element', 'JSX.Element | null', 'React.ReactNode', 'void', 'Promise<void>']
      : ['void', 'Promise<void>'];
    for (const spelling of spellings) {
      const current = readFileSync(file, 'utf-8');
      const lines = current.split('\n');
      const original = lines[line - 1];
      lines[line - 1] = original.replace(/\)(\s*)=>/, `): ${spelling}$1=>`);
      if (lines[line - 1] === original) break;
      writeFileSync(file, lines.join('\n'));
      if (typechecks()) { written += 1; break; }
      writeFileSync(file, current);
    }
  }
  if (false) for (const spelling of ['JSX.Element', 'JSX.Element | null']) {
    const lines = before.split('\n');
    for (const line of hits) {
      lines[line - 1] = lines[line - 1].replace(/\)(\s*)=>/, `): ${spelling}$1=>`);
    }
    writeFileSync(file, lines.join('\n'));
    if (typechecks()) {
      written += hits.length;
      break;
    }
    writeFileSync(file, before);
  }
}

console.log(`  Annotated ${written} component return type(s) across ${wanted.size} file(s).`);
