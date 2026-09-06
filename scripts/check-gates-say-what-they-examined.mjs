/**
 * A gate that passes must say what it examined.
 *
 * Four gates in this repository have now been found reporting safety while
 * measuring nothing:
 *
 *   - check-readiness-markers-are-printed matched the example quoted in its
 *     own header comment, because `scripts/` is in its own haystack;
 *   - every-localdb-reader-classifies-absence was satisfied first by a
 *     COMMENT naming the classifier and then, after comments were stripped,
 *     by the IMPORT LINE alone;
 *   - check-disconnect-reports-failure pinned an identifier the implementation
 *     had since replaced, so it was about to fail correct code;
 *   - check-intent-results-checked required `\w+\.execute(` while every call
 *     site in the tree writes `deps.io.execute(`, so it evaluated ZERO sites
 *     and printed success on every run for as long as it existed.
 *
 * The last one is the shape this gate is about. It did not report "nothing
 * matched". It reported success. "OK" and "OK, 0 files considered" are
 * indistinguishable at a glance, and only one of them is true.
 *
 * So: a gate's success output must contain a value it COMPUTED — a count of
 * files scanned, sites checked, entries compared. That number is what turns a
 * silent vacuity into a visible one, because a human reading CI output sees
 * `0 files considered` and a machine can floor it.
 *
 * This is a static check: it reads each gate's `console.log` calls and
 * requires at least one to interpolate. It deliberately does NOT run the
 * gates — that would double CI's gate cost to re-derive what reading the
 * source already shows, and several need a live stack or an argument.
 *
 * What it cannot do, stated plainly: interpolating a value is not proof the
 * value is meaningful, and a gate can still print a computed `0`. This raises
 * the floor; it does not make a gate correct. The per-gate floors (see
 * check-intent-results-checked) are what make a specific zero fail.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = basename(fileURLToPath(import.meta.url));
const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/**
 * Gates whose success is genuinely a single fact, with the reason.
 *
 * A gate lands here by somebody deciding it belongs and writing down why —
 * the same rule the other allow-lists in this repository follow, and for the
 * same reason: an exemption is a claim about the code, and one that is merely
 * inherited stops meaning anything.
 */
const SINGLE_FACT = new Map([
  [
    'check-submodule-gate-judges-a-worktree.mjs',
    'asserts one property of one other gate; there is no corpus to count',
  ],
]);

const gates = readdirSync(SCRIPTS)
  .filter((f) => /^check-.*\.mjs$/.test(f) && f !== SELF)
  .sort();

if (gates.length === 0) {
  console.error('FAIL: no gates found — this check would pass by considering nothing, which is the exact defect it exists to catch.');
  process.exit(1);
}

const problems = [];
let checked = 0;

for (const gate of gates) {
  const source = readFileSync(join(SCRIPTS, gate), 'utf8');

  // Every console.log argument list in the file. A gate's success line is a
  // console.log; its failures go to console.error by convention here.
  const logs = [...source.matchAll(/console\.log\(([\s\S]{0,600}?)\);/g)].map((m) => m[1]);

  if (logs.length === 0) {
    problems.push(`${gate} — passes without printing anything at all`);
    continue;
  }

  checked += 1;
  const interpolates = logs.some((body) => /\$\{/.test(body));
  if (interpolates) {
    if (SINGLE_FACT.has(gate)) {
      problems.push(
        `${gate} — reports a computed value now, so its SINGLE_FACT exemption is stale; remove it`,
      );
    }
    continue;
  }
  if (SINGLE_FACT.has(gate)) continue;

  problems.push(
    `${gate} — its success output is a fixed sentence; say how many things it examined`,
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=scripts/${p.split(' ')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} of ${gates.length} gate(s) report success without saying what they examined.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nInterpolate a count into the success line:\n' +
      "    console.log(`OK: ${n} thing(s) checked, all fine.`);\n\n" +
      'A gate that prints a fixed sentence cannot be told apart from one that\n' +
      'scanned nothing. check-intent-results-checked printed "every\n' +
      'failure-reporting intent is checked" on every run while matching zero\n' +
      'call sites, for as long as it existed.',
  );
  process.exit(1);
}

console.log(`check-gates-say-what-they-examined: all ${checked} gate(s) report a computed value.`);
