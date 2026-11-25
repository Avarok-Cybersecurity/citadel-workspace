#!/usr/bin/env node
/**
 * The installed npm tree satisfies every workspace's package.json: `npm ls --all` finds nothing new.
 *
 * Judges package-lock.json and the package.json files of the root, citadel-workspaces, its
 * integration-tests, citadel-workspace-client-ts and the agent's typescript-client. A problem npm
 * reports today is recorded in scripts/npm-tree.baseline.json (one: integration-tests asks for
 * @types/node ^20 and the lockfile serves it 22); a new one fails, and a fixed one fails until it is
 * removed from the baseline, so the baseline only shrinks.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareProblems, npmTreeProblems } from './lib/npm-tree.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'npm-tree.baseline.json');

const ls = spawnSync('npm', ['ls', '--all', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
let json;
try {
  json = JSON.parse(ls.stdout);
} catch {
  console.error(`FAIL: npm ls printed no JSON (exit ${ls.status}): ${ls.stderr.split('\n').slice(0, 5).join(' ')}`);
  process.exit(1);
}
const problems = npmTreeProblems(json, ROOT);

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${JSON.stringify(problems, null, 2)}\n`);
  console.log(`Recorded ${problems.length} npm tree problem(s).`);
  process.exit(0);
}

const { added, fixed } = compareProblems(problems, JSON.parse(readFileSync(BASELINE, 'utf8')));
if (added.length > 0) {
  console.error('FAIL: the installed npm tree no longer satisfies the package.json files:');
  for (const p of added) console.error(`  - ${p}`);
  console.error('  see it: npm ls --all   (fix the range or the lockfile: npm install at the repo root, then npm ci)');
  process.exit(1);
}
if (fixed.length > 0) {
  console.error('FAIL: npm tree problems were fixed; take them out of scripts/npm-tree.baseline.json so they cannot come back:');
  for (const p of fixed) console.error(`  - ${p}`);
  console.error('  node scripts/check-npm-tree-is-valid.mjs --write, then commit the baseline');
  process.exit(1);
}
const packages = Object.keys(json.dependencies ?? {}).length;
console.log(`npm tree: no new problem across ${packages} top-level package(s) (${problems.length} in the baseline).`);
