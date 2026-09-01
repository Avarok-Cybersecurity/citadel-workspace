#!/usr/bin/env node
/**
 * Every integration spec must be named by an npm script that runs it.
 *
 * `test:all` is an explicit chain — `npm run test:p2p && npm run test:crud &&
 * …` — not a directory glob. So a spec added to
 * `integration-tests/src/tests/` without its own `test:` entry never runs, and
 * nothing about the suite looks different: the file is there, it is committed,
 * it is plausibly named, and CI is green because nobody asked it to run.
 *
 * That is the same shape this repository keeps finding — written, correct,
 * never wired — applied to the tests themselves, which is the worst place for
 * it because a test that does not run is indistinguishable from one that
 * passes.
 *
 * `check-every-test-runs` (in citadel-workspaces/scripts) covers a neighbouring
 * property: that every file on disk lives in a directory some runner owns. It
 * maps DIRECTORIES to runners, so it cannot see a file in the right directory
 * that no individual script names. This closes that.
 *
 * The scripts name COMPILED paths (`node dist/tests/x.test.js`), not sources.
 * Comparing against `.test.ts` names finds nothing referenced and reports all
 * 47 specs as orphans, which is how this check was first written and why the
 * mapping is spelled out here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'citadel-workspaces', 'integration-tests');
const SPEC_ROOT = join(SUITE, 'src', 'tests');

const pkg = JSON.parse(readFileSync(join(SUITE, 'package.json'), 'utf8'));
const runners = Object.entries(pkg.scripts ?? {}).filter(([name]) => name.startsWith('test:'));
const commands = runners.map(([, body]) => body).join(' ');

function specs(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...specs(full));
    else if (entry.endsWith('.test.ts')) found.push(relative(SPEC_ROOT, full));
  }
  return found;
}

const all = specs(SPEC_ROOT);

// A guard that examines nothing passes as readily as one that examines
// everything: this suite has dozens of specs and dozens of runners.
if (all.length === 0 || runners.length === 0) {
  console.error(
    `Found ${all.length} spec(s) and ${runners.length} test: script(s); this check verified nothing.`,
  );
  process.exit(1);
}

const orphans = all.filter((spec) => !commands.includes(`dist/tests/${spec.replace(/\.ts$/, '.js')}`));

if (orphans.length > 0) {
  console.error('These integration specs are not named by any `test:` script, so they never run:\n');
  for (const spec of orphans) console.error(`  - src/tests/${spec}`);
  console.error(
    `\nAdd a script to integration-tests/package.json, e.g.\n` +
      `  "test:<name>": "npm run build && node dist/tests/${orphans[0].replace(/\.ts$/, '.js')}"\n` +
      `and chain it into test:all. A spec that does not run is indistinguishable\n` +
      `from one that passes.`,
  );
  process.exit(1);
}

console.log(`Integration specs OK: all ${all.length} are named by one of ${runners.length} test: scripts.`);
