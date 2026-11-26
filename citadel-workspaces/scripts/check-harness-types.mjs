#!/usr/bin/env node
/**
 * The harness scenarios (.jsx) gain no type error: each file's errors per code, ratcheted.
 *
 * tsconfig.harness.json checks them as JavaScript against the real component and app types,
 * implicit any allowed (they are JavaScript). What is there today is the baseline
 * (scripts/harness-types.baseline.json); a new error fails, and a fixed one fails until the smaller
 * count is recorded with --write and committed, so the baseline only shrinks.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, countErrors } from './harness-types-core.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(APP, 'scripts', 'harness-types.baseline.json');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

let output = '';
try {
  output = execFileSync(process.execPath, [tsc, '-p', 'tsconfig.harness.json'], { cwd: APP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
}
if (/error TS(5\d{3}|6\d{3}|2688)/.test(output)) {
  console.error(`FAIL: tsc could not check the harness at all (a config or setup error, not a scenario's):\n${output.split('\n').slice(0, 8).join('\n')}`);
  process.exit(1);
}
const found = countErrors(output);
const files = Object.keys(found).length;
const total = Object.values(found).reduce((n, byCode) => n + Object.values(byCode).reduce((a, b) => a + b, 0), 0);

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`Recorded ${total} harness type error(s) in ${files} file(s).`);
  process.exit(0);
}

const { grew, shrank } = compareToBaseline(found, JSON.parse(readFileSync(BASELINE, 'utf8')));
if (grew.length > 0) {
  console.error('FAIL: a harness scenario gained type errors (a component or app option it builds by hand has changed):');
  for (const g of grew) console.error(`  - ${g.file}: ${g.code} ${g.was} -> ${g.now}`);
  console.error(`\n  see them: cd citadel-workspaces && npx tsc -p tsconfig.harness.json | grep -F <file>`);
  process.exit(1);
}
if (shrank.length > 0) {
  console.error('FAIL: harness type errors were fixed; record the smaller baseline so they cannot come back:');
  for (const s of shrank) console.error(`  - ${s.file}: ${s.code} ${s.was} -> ${s.now}`);
  console.error('  node scripts/check-harness-types.mjs --write, then commit scripts/harness-types.baseline.json');
  process.exit(1);
}
const scenarios = readdirSync(resolve(APP, 'scripts', 'lib', 'polish-harness')).filter((f) => f.endsWith('.jsx')).length;
console.log(`Harness scenarios: no new type error (${total} in the baseline across ${files} file(s), ${scenarios} scenario files checked).`);
