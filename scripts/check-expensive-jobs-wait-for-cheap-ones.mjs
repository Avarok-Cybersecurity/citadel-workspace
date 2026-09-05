#!/usr/bin/env node
// A job that starts Docker must not run before every cheap gate has passed.
//
// Measured on this repo: one parent PR run is ~1,281 runner-minutes, and the
// integration matrix is 87% of it. With no `needs:` edge, a PR that fails
// `cargo clippy` in 229 seconds still runs 55 Docker jobs — about 1,230
// runner-minutes spent on a change that cannot merge. That happened three
// times in a single day, each on a trivial `-D warnings` lint: a needless
// borrow, a dead-code gate, an unused import.
//
// The org shares 20 concurrent job slots across four repos, so this is not
// only waste — it is the queue everything else is waiting behind.
//
// Rule: any job whose steps mention `docker compose` must `needs:` every job
// that runs `cargo fmt`, `cargo clippy`, `eslint` or `tsc`.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, '.github', 'workflows', 'validate.yml');
const wf = yaml.load(readFileSync(file, 'utf8'));

const jobs = wf.jobs ?? {};
const stepsText = (job) =>
  (job.steps ?? []).map((s) => `${s.run ?? ''} ${s.uses ?? ''}`).join('\n');

const CHEAP = /cargo\s+fmt|cargo\s+clippy|eslint|tsc\b/;
const EXPENSIVE = /docker\s+compose/;

const cheapJobs = Object.entries(jobs)
  .filter(([, j]) => CHEAP.test(stepsText(j)))
  .map(([name]) => name);
const expensiveJobs = Object.entries(jobs)
  .filter(([, j]) => EXPENSIVE.test(stepsText(j)))
  .map(([name]) => name);

if (cheapJobs.length === 0 || expensiveJobs.length === 0) {
  console.error(
    `Found ${cheapJobs.length} cheap and ${expensiveJobs.length} expensive jobs; ` +
      'this check verified nothing.',
  );
  process.exit(1);
}

const failures = [];
for (const name of expensiveJobs) {
  const declared = new Set(
    Array.isArray(jobs[name].needs) ? jobs[name].needs : jobs[name].needs ? [jobs[name].needs] : [],
  );
  const missing = cheapJobs.filter((c) => c !== name && !declared.has(c));
  if (missing.length) {
    failures.push(
      `${name} starts Docker without waiting for: ${missing.join(', ')}\n` +
        `      A failure in any of those still costs this job's full matrix.`,
    );
  }
}

if (failures.length) {
  console.error('Expensive jobs run before cheap gates have reported:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error(
    `Cheap jobs here: ${cheapJobs.join(', ')}\n` +
      'Add them to that job\'s `needs:`.',
  );
  process.exit(1);
}

console.log(
  `OK: all ${expensiveJobs.length} Docker job(s) wait for all ` +
    `${cheapJobs.length} cheap gate(s).`,
);
