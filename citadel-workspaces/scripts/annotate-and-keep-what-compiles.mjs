/**
 * Annotate the risky classes, compile, and keep only what holds.
 *
 * Two kinds of annotation are correct and can still break a build:
 *
 *   - `boolean` on a `const` holding a condition. Since TypeScript 4.4 that
 *     const narrows what it tested — `const isEditing = !!role` lets
 *     `if (isEditing)` treat `role` as non-null — and ANY annotation discards
 *     it. The narrowing was doing real work; the type was already known.
 *   - a literal type. Writing `2` narrows a numeric constant and every caller
 *     passing a different number stops compiling; widening to `number` breaks
 *     the string-union case the other way. 31 errors on the first attempt.
 *
 * Neither is decidable from the declaration: the answer is in how the value is
 * used, three modules away. So: write them, compile, and revert the files that
 * did not survive. The compiler is the judge, one file at a time, and the
 * result is a strictly larger set of honest annotations than any static rule
 * could have justified.
 *
 * Usage: node scripts/annotate-and-keep-what-compiles.mjs <pathPrefix>
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = process.argv[2] ?? 'src';

function run(command, args) {
  try {
    return { ok: true, out: execFileSync(command, args, { cwd: APP, encoding: 'utf-8' }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function typecheck() {
  const result = run('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit']);
  const files = new Set();
  for (const line of result.out.split('\n')) {
    const match = line.match(/^(src\/[^(]+)\(/);
    if (match) files.add(match[1]);
  }
  return { ok: result.ok, files: [...files] };
}

const before = typecheck();
if (!before.ok) {
  console.error('\n  The tree does not compile before annotating; nothing to judge against.\n');
  process.exit(1);
}

run('node', ['scripts/annotate-from-findings.mjs', prefix, '--allow-boolean', '--allow-literal', '--widen-strings', '--any-as-unknown']);

// `prefer-as-const` and friends: a literal annotation the linter rewrites is
// still a literal annotation, so lint-fixable problems are settled here rather
// than left for a human to find in a 300-file diff.
run('npx', ['eslint', '--fix', prefix]);

let round = 0;
for (;;) {
  round += 1;
  const check = typecheck();
  if (check.ok) break;
  if (check.files.length === 0 || round > 80) {
    console.error('\n  Errors that name no file, or too many rounds — reverting everything.\n');
    run('git', ['checkout', '--', prefix]);
    process.exit(1);
  }
  console.log(`  round ${round}: reverting ${check.files.length} file(s) the compiler rejected`);
  run('git', ['checkout', '--', ...check.files]);
}

console.log(`  Kept every annotation that compiles, after ${round - 1} revert round(s).`);
