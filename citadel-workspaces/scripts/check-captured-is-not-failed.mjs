/**
 * What a spec CAPTURES from the console is not what it counts as a FAILURE.
 *
 * The reconnection specs capture broadly on purpose. `'ILM'` is in their capture
 * list because a delivery failure with no ILM lines in the log has nothing to
 * diagnose from — the comment above that list says so.
 *
 * Four of the five then reused the same list to decide what was an error. So
 * every informational router line — `[ILM-Router] Registering CID <n> for self
 * (leader's own connection)` — became a `critical/functional` UX failure and an
 * entry in `consoleErrors`. A run reports errors it does not have, and that is
 * how the ones it does have stop being noticed: the reader learns the error list
 * is noise and stops reading it.
 *
 * `c2s-reconnect.test.ts` in the same directory already separated the two. The
 * correct implementation was one file away from the four that had not adopted it,
 * which is the most common defect shape in this repository.
 *
 * The rule: a list used to CLASSIFY a console message as an error must not be the
 * same list passed to `setupConsoleCapture`. They answer different questions.
 *
 * This does not judge the CONTENTS of either list — a spec is entitled to decide
 * what counts as a failure for it. It requires only that the decision be made
 * separately from the decision about what to record.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = join(APP, 'integration-tests', 'src');

if (!existsSync(SPECS)) {
  console.error(`FAIL: ${relative(APP, SPECS)} does not exist — this gate examined nothing.`);
  process.exit(1);
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* files(full); continue; }
    if (entry.endsWith('.ts')) yield full;
  }
}

/** `setupConsoleCapture(page, name, <list>)` — the third argument names the capture list. */
const CAPTURE = /setupConsoleCapture\s*\([^,]+,[^,]+,\s*([A-Za-z_]\w*)\s*\)/g;

/** A console message being classified as a failure by some list. */
const CLASSIFY = /\b([A-Za-z_]\w*)\.some\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.includes\(/g;

const problems = [];
let specsWithBoth = 0;

for (const file of files(SPECS)) {
  const source = readFileSync(file, 'utf8');
  const captureLists = new Set([...source.matchAll(CAPTURE)].map((m) => m[1]));
  if (captureLists.size === 0) continue;

  const classifyLists = new Set([...source.matchAll(CLASSIFY)].map((m) => m[1]));
  if (classifyLists.size === 0) continue;
  specsWithBoth += 1;

  for (const list of classifyLists) {
    if (!captureLists.has(list)) continue;
    problems.push(
      `${relative(APP, file)}: \`${list}\` is both the capture list and the failure list — ` +
        'every line worth recording becomes an error the run did not have',
    );
  }
}

// Vacuity floor: these specs exist and use both mechanisms. Finding none means a
// pattern stopped matching, not that the suite stopped conflating them.
if (specsWithBoth === 0) {
  console.error(
    'FAIL: found no spec that both captures console output and classifies it. One of the\n' +
      'two patterns stopped matching, so this gate examined nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} spec(s) use one list for two questions.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nKeep the capture list broad — it is what you read when something goes wrong — and\n' +
      'give the failure check its own, narrower list. `c2s-reconnect.test.ts` does this.\n' +
      '\nA run that reports errors it does not have teaches the reader to ignore the error\n' +
      'list, which costs more than the noise itself.',
  );
  process.exit(1);
}

console.log(
  `check-captured-is-not-failed: ${specsWithBoth} spec(s) both capture and classify console ` +
    'output; none reuses its capture list to decide what failed.',
);
