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
import { retryPasses } from './lib/retry-passes.mjs';

const report = process.argv[2] ?? 'reports/results.json';

if (!existsSync(report)) {
  // Loudly, not silently: a missing report means this check verified nothing,
  // and "no flaky specs" would be a lie told by an absent file.
  console.error(`::error::${report} not found — the flaky-spec report could not be read.`);
  console.error('The Playwright json reporter writes it in CI, at the END of the run: a test step killed by\n' +
    'its timeout-minutes never writes it (keep --global-timeout under the step budget). If the reporter\n' +
    'config changed instead, this check is blind.');
  process.exit(1);
}

const { flaky, rerun } = retryPasses(JSON.parse(readFileSync(report, 'utf8')));

if (rerun.length > 0) {
  // Not flaky: a serial block retries as a whole, so these ran again behind another test's failure.
  console.log(`${rerun.length} spec(s) ran twice only because their serial block retried after another test failed:`);
  for (const r of rerun) console.log(`  ${r.file} — ${r.title}`);
  console.log('');
}

if (flaky.length === 0) {
  console.log(`No spec passed only after a failed attempt (${report}).`);
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
