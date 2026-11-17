/**
 * Every unit-test file on disk is one vitest actually collects.
 *
 * `include` was a bare recursive glob with a list of excluded
 * directories, which was whack-a-mole: each Playwright spec added anywhere
 * under integration-tests/ arrived as a vitest failure. Replacing it with a
 * named list fixed that and silently dropped
 * `scripts/__tests__/lighthouse-shortfall.test.ts` — 342 files before, 342
 * after, one swapped for another. Nothing in the run said a file had stopped
 * being run, because nothing counts the files that exist.
 *
 * That is the shape this repository keeps finding: a test that does not run
 * is indistinguishable from a test that passes.
 *
 * So: every `*.test.ts` / `*.spec.ts` under the workspace is either collected
 * by vitest or accounted for here by the runner that DOES run it.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories whose specs are driven by a different runner, and which one.
 * Adding an entry is a claim that something else runs them; say what.
 */
const RUN_ELSEWHERE = new Map([
  ['integration-tests/src/tests', 'the standalone node runner (npm run test:*)'],
  ['integration-tests/src/tests-pw', 'Playwright (playwright.config.ts)'],
  ['integration-tests/src/tools', 'Playwright, invoked by hand for screenshots and sweeps'],
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'playwright-report', 'test-results']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(relative(APP, full));
  }
  return out;
}

const onDisk = walk(APP).sort();

const listed = execFileSync('npx', ['vitest', 'list', '--filesOnly'], {
  cwd: APP,
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /\.(test|spec)\.(ts|tsx)$/.test(line));
const collected = new Set(listed);

const orphans = onDisk.filter((file) => {
  if (collected.has(file)) return false;
  for (const dir of RUN_ELSEWHERE.keys()) if (file.startsWith(`${dir}/`)) return false;
  return true;
});

if (orphans.length > 0) {
  console.error('\n  Test files that no runner collects:\n');
  for (const file of orphans) console.error(`::error file=citadel-workspaces/${file}::not collected by vitest`);
  console.error(
    '\n  A test that does not run is indistinguishable from a test that passes.\n' +
    '  Either widen `include` in vitest.config.ts, or add its directory to\n' +
    '  RUN_ELSEWHERE in this script naming the runner that does run it.\n',
  );
  process.exit(1);
}

console.log(
  `  Every test runs: ${collected.size} collected by vitest, ` +
  `${onDisk.length - collected.size} by ${RUN_ELSEWHERE.size} other runner(s)  ok`,
);
