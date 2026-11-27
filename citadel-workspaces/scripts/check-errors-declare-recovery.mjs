/**
 * A failure shown with no way out is a dead end, and dead ends may only go down.
 *
 * The owner's ask (REL-1127): "my next step at any error or issue [should be] intuitive/
 * deterministic. Having a hard dead-end is not good." The way out is declared once, in a surface's
 * RecoveryPlan (src/lib/recovery-route/surfaces/), and drawn by one renderer. Every failure shown
 * by hand instead -- a destructive toast with no action, `toast.error`, `role="alert"`, a
 * destructive `<Alert>`, `window.alert` -- is a dead-end candidate (scripts/lib/recovery-sinks.mjs).
 *
 * A second ratchet holds copy catch-alls: `Partial<Record<…>>` and a `switch` whose `default`
 * returns a sentence. Both answer a case nobody wrote copy for with generic words, which is how a
 * new refusal reads as "Something went wrong" with nothing to do.
 *
 * Ratcheted against baselines, per file and kind: a count may not rise, and a new file may add
 * none. Moving a surface onto RecoveryNotice/recoveryToast lowers its count; record that with
 * --write. What this cannot see: whether the declared route works (the controls' unit tests do),
 * whether the copy is right, and failures drawn as plain text with no sink marker.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanApp } from './lib/recovery-sinks.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { deadEnds, catchAllCopy, declared } = scanApp(APP);

const RATCHETS = [
  {
    name: 'Dead ends', file: 'dead-ends.baseline.json', found: deadEnds,
    advice: 'Each of these tells a person something failed and declares nothing they can do next. Give it a\n  surface in src/lib/recovery-route/surfaces/ and draw it with <RecoveryNotice> or recoveryToast().',
  },
  {
    name: 'Copy catch-alls', file: 'copy-catch-alls.baseline.json', found: catchAllCopy,
    advice: 'Each of these answers a case nobody wrote copy for. Key the copy by the whole union (a mapped\n  type `{ [K in Union]: string }`) so a new variant fails to compile until it has its own words.',
  },
];

const sortedOf = (found) => Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
const totalOf = (found) => Object.values(found).reduce((n, c) => n + c, 0);

if (process.argv.includes('--write')) {
  for (const { name, file, found } of RATCHETS) {
    writeFileSync(resolve(APP, 'scripts', file), `${JSON.stringify(sortedOf(found), null, 2)}\n`);
    console.log(`${name}: recorded ${totalOf(found)} in ${Object.keys(found).length} place(s).`);
  }
  process.exit(0);
}

let failed = false;
for (const { name, file, found, advice } of RATCHETS) {
  const path = resolve(APP, 'scripts', file);
  if (!existsSync(path)) {
    console.error(`  ${name}: scripts/${file} is missing -- run with --write and commit it  FAIL`);
    failed = true;
    continue;
  }
  const baseline = JSON.parse(readFileSync(path, 'utf-8'));
  const regressions = Object.entries(sortedOf(found))
    .filter(([key, count]) => count > (baseline[key] ?? 0))
    .map(([key, count]) => `  ${key}: ${count} (was ${baseline[key] ?? 0})`);
  if (regressions.length > 0) {
    console.log(`  ${name}, new:\n\n${regressions.join('\n')}\n\n  ${advice}\n`);
    failed = true;
    continue;
  }
  const lower = Object.entries(baseline).filter(([key, count]) => (found[key] ?? 0) < count).length;
  console.log(`  ${name}: no new ones (${totalOf(found)} in the code${lower > 0 ? `; ${lower} place(s) went down -- record with --write` : ''})  ok`);
}
console.log(`  Declared surfaces drawn: ${declared}`);
process.exit(failed ? 1 : 0);
