#!/usr/bin/env node
/**
 * Name every spec that passed only after a retry.
 *
 * Playwright counts a retry-pass as a pass. The shard prints `42 passed` and
 * `1 flaky`, exits 0, and the job is green — so the one line that matters is
 * buried in five thousand lines of log, and the summary actively says
 * everything is fine.
 *
 * WRITTEN BECAUSE IT HID A REAL DEFECT, ONCE, IMMEDIATELY. After the first
 * member-list fix, `member-list-loading.spec.ts` stopped failing all three
 * retries and started failing its FIRST attempt and passing on retry:
 *
 *     ✘  17 ... the sidebar never reports an empty member list while loading
 *     ✓  18 ... (retry #1)
 *
 * That is what a one-frame race looks like in a suite with retries, and it was
 * a genuine defect — the loading flag was a render behind on a domain change.
 * The shard was green. Nothing but reading the ✘/✓ markers by hand would have
 * found it.
 *
 * WARNS, does not fail. Retries exist to absorb genuine infrastructure noise,
 * and this repository already records that a gate which goes red on noise is
 * worse than no gate: people learn to ignore it. Making a retry-pass FAIL is a
 * policy change that wants more than one data point. Making it impossible to
 * miss does not.
 */
import { readFileSync, existsSync } from 'node:fs';

const report = process.argv[2] ?? 'reports/results.json';

if (!existsSync(report)) {
  // Loudly, not silently: a missing report means this check verified nothing,
  // and "no flaky specs" would be a lie told by an absent file.
  console.error(`::error::${report} not found — the flaky-spec report could not be read.`);
  console.error('The Playwright json reporter writes it in CI; if that changed, this check is blind.');
  process.exit(1);
}

const results = JSON.parse(readFileSync(report, 'utf8'));
const flaky = [];

const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      // Playwright's own definition: expected outcome, reached after >1 attempt.
      const attempts = test.results?.length ?? 0;
      if (test.status === 'flaky' || (attempts > 1 && test.status === 'expected')) {
        const failed = (test.results ?? []).filter((r) => r.status !== 'passed').length;
        flaky.push({ title: spec.title, file: spec.file ?? suite.file, attempts, failed });
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of results.suites ?? []) walk(suite);

if (flaky.length === 0) {
  console.log(`No spec needed a retry (${report}).`);
  process.exit(0);
}

console.log(`${flaky.length} spec(s) passed only after a retry:\n`);
for (const f of flaky) {
  console.log(`  ${f.file} — ${f.title}  (${f.failed} of ${f.attempts} attempts failed)`);
  console.log(
    `::warning file=${f.file}::"${f.title}" failed its first attempt and passed on retry. ` +
    `A retry-pass is reported as a pass; it is usually a race, and at least once here it was a ` +
    `one-frame render race in production code.`);
}
console.log('\nA retry-pass is not a pass. Read the first failure before trusting the green.');
