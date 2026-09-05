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

// No js-yaml. This gate runs in the crate-coverage job, which installs nothing,
// so a dependency here dies on `Cannot find module 'js-yaml'` and takes every
// other gate in that job down with it. check-service-logs-are-captured made
// that mistake, then check-ci-job-timeouts made it again -- its header says
// "Third time" -- and this file made it a fourth, turning the whole job red on
// the run that was meant to prove this gate works.
//
// So the workflow is read as text. A GitHub workflow's shape is fixed enough:
// job keys are the only two-space-indented keys under `jobs:`, and everything
// belonging to a job is indented further. The counts below are asserted, so a
// file that stops matching fails loudly rather than reporting agreement it
// never established.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, '.github', 'workflows', 'validate.yml');

/** job name -> { text: everything under it, needs: Set } */
function readJobs(source) {
  const jobs = new Map();
  let inJobs = false;
  let current = null;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line)) { inJobs = false; continue; }
    const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobKey) { current = jobKey[1]; jobs.set(current, { commands: '', needs: new Set(), inRun: undefined }); continue; }
    if (current === null) continue;
    const job = jobs.get(current);
    // Only what the job RUNS, never its comments.
    //
    // Matching the raw job text classified integration-tests and
    // playwright-tests as cheap, because their comments mention eslint and
    // clippy -- and a job cannot need itself, so the gate then demanded
    // impossible edges. `run:` bodies and `uses:` values only, with trailing
    // comments stripped.
    if (job.inRun !== undefined && /\S/.test(line)) {
      const indent = line.length - line.trimStart().length;
      if (indent > job.inRun) {
        job.commands += `${line.split('#')[0]}\n`;
      } else {
        job.inRun = undefined;
      }
    }
    const run = line.match(/^(\s*)-?\s*run:\s*(.*)$/);
    if (run) {
      job.inRun = run[1].length;
      job.commands += `${run[2].split('#')[0]}\n`;
    }
    const uses = line.match(/^\s*-?\s*uses:\s*(\S+)/);
    if (uses) job.commands += `${uses[1]}\n`;
    // `needs: a` or `needs: [a, b]` on one line, or a block list beneath it.
    const inline = line.match(/^ {4}needs:\s*(.+)$/);
    if (inline) {
      for (const n of inline[1].replace(/[[\]]/g, '').split(',')) {
        const name = n.trim();
        if (name) job.needs.add(name);
      }
      continue;
    }
    if (/^ {4}needs:\s*$/.test(line)) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = lines[j].match(/^ {6}-\s*(\S+)\s*$/);
        if (!item) break;
        job.needs.add(item[1]);
          i = j;
      }
    }
  }
  return jobs;
}

const jobs = Object.fromEntries(readJobs(readFileSync(file, 'utf8')));
const stepsText = (job) => job.commands;

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
  const declared = jobs[name].needs;
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
