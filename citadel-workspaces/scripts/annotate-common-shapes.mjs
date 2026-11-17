/**
 * Annotate the handful of shapes that are left, one line at a time.
 *
 * Each is a rewrite whose answer is written in the line itself, so nothing is
 * inferred and nothing is guessed:
 *
 *   const r = await fetchFn()          -> Awaited<ReturnType<typeof fetchFn>>
 *   const m = vi.fn().mockResolvedValue(x) -> ReturnType<typeof vi.fn>
 *   const c = useConfirm()             -> ReturnType<typeof useConfirm>
 *
 * The general tool proposes most of these and then loses them: when anything
 * else in the same file fails to compile, the whole file goes back. Applying
 * one line at a time and asking the compiler after each is slower per edit and
 * strictly better per outcome -- a line that cannot take its type costs itself
 * and nothing else.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPEDEF = '@typescript-eslint/typedef';

const eslint = new ESLint({
  cwd: APP,
  overrideConfigFile: resolve(APP, 'eslint.config.js'),
  overrideConfig: {
    rules: {
      [TYPEDEF]: ['error', {
        variableDeclaration: true, memberVariableDeclaration: true,
        propertyDeclaration: true, parameter: true, arrowParameter: false,
        variableDeclarationIgnoreFunction: true,
      }],
    },
  },
});

const PATH = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;
/** [pattern, how to build the annotation from the match] */
const SHAPES = [
  // `const r = await f(...)`
  [new RegExp(`^(\\s*)(const|let) (\\w+) = await (${PATH})\\(`), (m) => `Awaited<ReturnType<typeof ${m[4]}>>`],
  // `const m = vi.fn()...` — every mock method returns the mock.
  [new RegExp(`^(\\s*)(const|let) (\\w+) = (vi\\.fn)\\(`), () => 'ReturnType<typeof vi.fn>'],
  // `const c = f(...)` with a plain callee.
  [new RegExp(`^(\\s*)(const|let) (\\w+) = (${PATH})\\(`), (m) => `ReturnType<typeof ${m[4]}>`],
];

function typechecks() {
  try {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], { cwd: APP, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

let written = 0;
let considered = 0;
for (const result of await eslint.lintFiles(['src/**/*.ts', 'src/**/*.tsx'])) {
  const hits = [...new Set(result.messages.filter((m) => m.ruleId === TYPEDEF).map((m) => m.line))];
  for (const line of hits.sort((a, b) => b - a)) {
    const before = readFileSync(result.filePath, 'utf-8');
    const lines = before.split('\n');
    const text = lines[line - 1] ?? '';
    const shape = SHAPES.find(([pattern]) => pattern.test(text));
    if (!shape) continue;
    considered += 1;
    const match = text.match(shape[0]);
    lines[line - 1] = text.replace(
      new RegExp(`^(\\s*)(const|let) (${match[3]})`),
      `$1$2 $3: ${shape[1](match)}`,
    );
    if (lines[line - 1] === text) continue;
    writeFileSync(result.filePath, lines.join('\n'));
    if (typechecks()) written += 1;
    else writeFileSync(result.filePath, before);
  }
}

console.log(`  Annotated ${written} of ${considered} candidate line(s).`);
