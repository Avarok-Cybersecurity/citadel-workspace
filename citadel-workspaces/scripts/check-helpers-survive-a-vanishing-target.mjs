/**
 * A helper must not die because the thing it was closing closed itself.
 *
 * `closeAnyModals` clicked a Cancel button that was mid-animation. Playwright
 * waits for stability, retries, and when the dialog finished closing on its own
 * the element detached — so it retried for the rest of its thirty seconds and
 * then threw, out of a HELPER, killing whichever spec had called it:
 *
 *   element is not stable / element was detached from the DOM, retrying
 *   at closeAnyModals ... at createAccount ... at runTest
 *
 * The helper's own loop already decides whether a modal is still there. The
 * click is an attempt, not an assertion, and an attempt that loses its target
 * has succeeded.
 *
 * So: every click inside `lib/` on something transient -- a modal's close, a
 * toast's dismiss -- carries its own short timeout and swallows the rejection.
 * Specs are exempt: a spec's click IS its assertion, and one that cannot land
 * is a failure worth reporting.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODALS = join(APP, 'integration-tests', 'src', 'lib', 'modals.ts');

const source = readFileSync(MODALS, 'utf-8');
const clicks = [...source.matchAll(/\.click\(([^)]*)\)/g)];

if (clicks.length === 0) {
  console.error('\n  No clicks in lib/modals.ts — the file moved, so this checks nothing.\n');
  process.exit(1);
}

const bare = clicks.filter((match) => !/timeout/.test(match[1]));
if (bare.length > 0) {
  console.error(
    `\n  ${bare.length} click(s) in lib/modals.ts have no timeout of their own.\n\n` +
    '  A modal or toast that closes itself detaches the element mid-click, and the\n' +
    '  default thirty-second retry then throws out of a helper and kills the spec\n' +
    '  that called it. Give it a short timeout and swallow the rejection; the\n' +
    "  helper's own loop decides whether anything is still open.\n",
  );
  process.exit(1);
}

// Swallowed, too: a timeout that still rejects is the same failure, later.
const unguarded = clicks.filter((match) => {
  const after = source.slice(match.index + match[0].length, match.index + match[0].length + 40);
  return !/\.catch\(/.test(after);
});
if (unguarded.length > 0) {
  console.error(`\n  ${unguarded.length} click(s) in lib/modals.ts reject rather than shrug.\n`);
  process.exit(1);
}

console.log(`  ${clicks.length} transient click(s) in lib/modals.ts survive a vanishing target  ok`);
