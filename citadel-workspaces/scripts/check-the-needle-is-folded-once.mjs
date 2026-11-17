#!/usr/bin/env node
/**
 * Filtering a collection must not fold the query once per candidate.
 *
 * `matchesSearch(haystack, needle)` folds BOTH arguments: NFD-normalise,
 * strip combining marks, lower-case. Inside a `.filter`/`.some`/`.map` the
 * needle is loop-invariant, so that work is repeated for every candidate —
 * filtering a 500-node tree normalised the same three characters 500 times,
 * synchronously in the render pass, on every keystroke. All three call sites in
 * this app had that shape.
 *
 * `searchMatcher(needle)` folds once and returns the predicate.
 *
 * The rule: `matchesSearch` may not be called inside an iteration callback.
 * `matchesSearch` itself remains correct for a genuine one-off comparison, which
 * is why it is not simply deleted.
 *
 * Detected by looking at what precedes the call on the same logical span, not by
 * parsing: a `.filter(`, `.some(`, `.every(`, `.map(` or `.find(` opened within
 * the preceding 200 characters and not yet closed. That is coarse, and its
 * limit is stated in the output rather than implied — it will not see a
 * predicate defined as a named function elsewhere and passed in.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(UI, 'src');
const AUTHORITY = 'src/lib/fold-for-search.ts';

const ITERATION = /\.(filter|some|every|map|find|findIndex|flatMap)\s*\(/g;

/**
 * Production sources only.
 *
 * `__tests__` is skipped because the test for this very rule uses BOTH forms on
 * purpose — it counts `normalize` calls for each to show the difference, so the
 * slow form appearing there is the measurement, not the defect. A gate that
 * flagged its own proof would have to be switched off to keep the proof.
 */
function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* sources(full); continue; }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

/** Source with comments blanked, line count preserved. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, (m, p) => p + ' '.repeat(m.length - p.length)))
    .join('\n');
}

const offenders = [];
let callsSeen = 0;

for (const file of sources(SRC)) {
  const rel = relative(UI, file);
  if (rel === AUTHORITY) continue; // where both are defined
  const text = withoutComments(readFileSync(file, 'utf8'));

  for (const m of text.matchAll(/\bmatchesSearch\s*\(/g)) {
    callsSeen += 1;
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    // An iteration callback is open if one was started and its paren is not
    // yet balanced by the time we reach this call.
    let open = false;
    for (const it of before.matchAll(ITERATION)) {
      const after = before.slice(it.index + it[0].length);
      const depth = (after.match(/\(/g) ?? []).length - (after.match(/\)/g) ?? []).length;
      if (depth >= 0) open = true;
    }
    if (open) {
      offenders.push(
        `${rel}:${text.slice(0, m.index).split('\n').length}: calls matchesSearch inside an ` +
          'iteration callback — the needle is folded once per candidate',
      );
    }
  }
}

// Vacuity floor: the authority must still export both, or this gate is checking
// a function that no longer exists.
const authority = readFileSync(join(UI, AUTHORITY), 'utf8');
for (const name of ['matchesSearch', 'searchMatcher']) {
  if (!authority.includes(`export function ${name}`)) {
    console.error(
      `FAIL: ${AUTHORITY} no longer exports \`${name}\`.\n` +
        'The search API changed — point this gate at its replacement rather than\n' +
        'leaving it matching a name nothing defines.',
    );
    process.exit(1);
  }
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} search(es) fold the query per candidate.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nUse `searchMatcher(needle)` and hoist it out of the loop. `matchesSearch` folds\n' +
      'both arguments on every call: NFD-normalise, strip marks, lower-case. Over a\n' +
      '500-node tree that is 500 normalisations of the same query, in the render pass,\n' +
      'on every keystroke.',
  );
  process.exit(1);
}

console.log(
  `check-the-needle-is-folded-once: ${callsSeen} matchesSearch call(s) outside the authority; ` +
    'none inside an iteration callback. Does not see a named predicate passed in from elsewhere.',
);
