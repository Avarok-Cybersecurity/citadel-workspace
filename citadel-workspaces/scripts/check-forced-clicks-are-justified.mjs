#!/usr/bin/env node
/**
 * A forced click in the responsive suite hides what that suite measures.
 *
 * `click({ force: true })` skips Playwright's actionability checks — visible,
 * stable, enabled, and NOT covered by something else. In most suites that is a
 * pragmatic shortcut. In the responsive suite it is self-defeating: one of its
 * own tests is called "workspace shell has no unhittable controls", and forcing
 * a click is exactly how an unhittable control passes.
 *
 * It cost a real diagnosis. "notification centre fits the viewport" clicked the
 * bell with `force: true`, an overlay left by an earlier test in the same
 * shared page swallowed it, the sheet never opened, and the assertion below
 * spent thirty seconds to report "element(s) not found" — twice over two runs,
 * once as a flake and once as a failure. Without the force, Playwright names
 * the element that intercepted the pointer.
 *
 * The five below predate this and are held, not fixed: changing clicks in a
 * suite that cannot run here would be guessing. The list may only SHRINK.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SPEC = join(ROOT, 'integration-tests', 'src', 'tests-pw', 'responsive.spec.ts');

/**
 * Identified by WHAT is clicked, not by the whole call.
 *
 * The first version listed each line verbatim, which meant this file contained
 * five copies of `.click({ force: true })` — and `gates-do-not-force-clicks`
 * scans every script here for exactly that and failed. Its scope is the
 * browser-driving gates and mine is the spec, so they are not duplicates; but a
 * baseline that quotes the pattern it polices trips the guard that polices this
 * directory. The locator alone identifies these just as well.
 */
const KNOWN_FORCED = [
  'button',
  'advanced',
  'toggle',
  "getByRole('tab', { name: /^theme$/i })",
  "getByTestId('preview-region-sidebar')",
];

if (!existsSync(SPEC)) {
  console.error(`::error::${SPEC} — listed here but not present; this check is out of date`);
  process.exit(1);
}

const lines = readFileSync(SPEC, 'utf8').split('\n');
const problems = [];
const unseen = new Set(KNOWN_FORCED);
let checked = 0;

lines.forEach((line, i) => {
  const trimmed = line.trim();
  if (!/force:\s*true/.test(trimmed)) return;
  // The prose in this file discusses `force: true`; only calls count.
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
  checked += 1;
  const known = KNOWN_FORCED.find((k) => trimmed.includes(`${k}.click(`));
  if (known !== undefined) { unseen.delete(known); return; }
  problems.push([`integration-tests/src/tests-pw/responsive.spec.ts:${i + 1}`, trimmed.slice(0, 90)]);
});

for (const gone of unseen) {
  problems.push(['KNOWN_FORCED', `"${gone}" no longer forces its click — remove it from the list`]);
}

if (problems.length > 0) {
  console.error('\n  Forced clicks in the responsive suite:\n');
  for (const [where, what] of problems) console.error(`::error::${where} — ${what}`);
  console.error(
    '\n  Close what is covering the control and click normally. `force: true`\n' +
    '  skips the check that would tell you what was in the way, which is the\n' +
    '  thing this suite exists to find.\n',
  );
  process.exit(1);
}

console.log(`  Forced clicks: ${checked} in the responsive suite, all accounted for  ok`);
